import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import express from 'express';
import { db, initSchema } from '../src/db.js';
import { authMiddleware } from '../src/auth.js';
import { ordersRouter } from '../src/routes/orders.js';
import { errorHandler } from '../src/error-handler.js';
import type { OrderRow } from '../src/dal/orders-dal.js';

let server: Server;
let origin: string;
const buyer = 'buyer@example.com';
// Each tenant gets matching data. Mixed timestamps mirror API-created and seeded orders.
const fixtures = [
  ['new', buyer, 1000, 'sale', 'completed', '2026-11-03T00:00:00.000Z'],
  ['last', buyer, 1500, 'sale', 'completed', '2026-11-02T23:59:59.999Z'],
  ['refund', buyer, 500, 'refund', 'completed', '2026-11-02 12:00:00'],
  ['other', 'buyer+tag@example.com', 1000, 'sale', 'completed', '2026-11-02T10:00:00.000Z'],
  ['pending', buyer, 1000, 'sale', 'pending', '2026-11-02T08:00:00.000Z'],
  ['tie_z', 'BUYER@EXAMPLE.COM', 1000, 'sale', 'completed', '2026-11-01 12:00:00'],
  ['tie_a', buyer, 1000, 'sale', 'completed', '2026-11-01T12:00:00.000Z'],
  ['first', buyer, 1, 'sale', 'completed', '2026-11-01 00:00:00'],
  ['old', buyer, 1000, 'sale', 'completed', '2026-10-31T23:59:59.999Z'],
] as const;

function insert(id: string, merchantId: string, email: string, amount: number, type: string, status: string, date: string) {
  db.prepare(`INSERT INTO orders (id, merchant_id, customer_email, total_amount, type, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, merchantId, email, amount, type, status, date);
}

before(async () => {
  initSchema();
  for (const id of ['m_a', 'm_b', 'm_empty']) {
    db.prepare('INSERT INTO merchants (id, name) VALUES (?, ?)').run(id, id);
  }
  const app = express();
  app.use(express.json());
  app.use('/api/orders', authMiddleware, ordersRouter);
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  origin = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  db.prepare('DELETE FROM orders').run();
  for (const merchant of ['m_a', 'm_b']) {
    for (const [id, email, amount, type, status, date] of fixtures) {
      insert(`${merchant}_${id}`, merchant, email, amount, type, status, date);
    }
  }
});

after(async () => {
  if (server?.listening) {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  db.close();
});

async function search(query = '', merchant: string | null = 'm_a') {
  const response = await fetch(`${origin}/api/orders/search?${query}`, {
    headers: merchant === null ? {} : { 'X-Merchant-Id': merchant },
    signal: AbortSignal.timeout(5000),
  });
  return { status: response.status, body: await response.json() };
}

async function matches(query: string, suffixes: string[], merchant = 'm_a') {
  const result = await search(query, merchant);
  assert.equal(result.status, 200, query);
  const orders = result.body.orders as OrderRow[];
  assert.deepEqual(orders.map((order) => order.id), suffixes.map((id) => `${merchant}_${id}`), query);
  assert.ok(orders.every((order) => order.merchant_id === merchant));
  assert.ok(orders.every((order) => !('search_time' in order)), 'Internal sort value must not be exposed');
  return result.body;
}

test('search: normalizes stored dates and breaks equal-instant ties by descending ID', async () => {
  const body = await matches('', fixtures.map(([id]) => id));
  assert.deepEqual(body.pagination, { limit: 20, next_cursor: null });
  assert.equal(body.orders.find((order: OrderRow) => order.id === 'm_a_tie_z').created_at, '2026-11-01 12:00:00');
});

test('search: combines all filters and isolates merchants with otherwise identical rows', async () => {
  const query = 'customer_email=BUYER%40example.com&status=completed&type=sale&from=2026-11-01&to=2026-11-03&min_amount=1000&max_amount=1500';
  for (const merchant of ['m_a', 'm_b']) {
    await matches(query, ['last', 'tie_z', 'tie_a'], merchant);
    await matches('', fixtures.map(([id]) => id), merchant);
  }
  const override = await search(`${query}&merchant_id=m_b`);
  assert.equal(override.status, 400);
  assert.equal(override.body.error, 'invalid_search_query');
});

test('search: email is exact, case-insensitive and SQL-bound, including apostrophes', async () => {
  await matches('customer_email=buyer%40EXAMPLE.com', fixtures.filter(([id]) => id !== 'other').map(([id]) => id));
  await matches('customer_email=unknown%40example.com', []);
  insert('m_a_quote', 'm_a', "o'connor@example.com", 1000, 'sale', 'completed', '2026-11-02 00:00:00');
  await matches(new URLSearchParams({ customer_email: "o'connor@example.com" }).toString(), ['quote']);
});

test('search: type and status independently filter stored values without changing creation rules', async () => {
  await matches('type=refund', ['refund']);
  await matches('status=pending', ['pending']);
  await matches('status=COMPLETED', []);
  await matches('type=refund&status=pending', []);
});

test('search: supports one-sided date ranges and excludes midnight at the upper bound', async () => {
  await matches('from=2026-11-02', ['new', 'last', 'refund', 'other', 'pending']);
  await matches('to=2026-11-02', ['tie_z', 'tie_a', 'first', 'old']);
  await matches('from=2026-11-01&to=2026-11-02', ['tie_z', 'tie_a', 'first']);
  await matches('from=2024-02-29&to=2024-03-01', []);
});

test('search: amount bounds are inclusive integer cents, including positive refund amounts', async () => {
  await matches('min_amount=1001', ['last']);
  await matches('max_amount=500', ['refund', 'first']);
  await matches('min_amount=500&max_amount=500', ['refund']);
  await matches('min_amount=0&max_amount=0', []);
  await matches(`min_amount=${Number.MAX_SAFE_INTEGER}`, []);
});

test('search: paginates through ties without repeats or gaps, even if a newer order is inserted', async () => {
  for (const filter of ['', 'customer_email=buyer%40example.com']) {
    const expected = fixtures.filter(([id]) => !filter || id !== 'other').map(([id]) => `m_a_${id}`);
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < fixtures.length; page++) {
      const params = new URLSearchParams(filter);
      params.set('limit', '2');
      if (cursor) params.set('cursor', cursor);
      const result = await search(params.toString());
      assert.equal(result.status, 200);
      assert.equal(result.body.pagination.limit, 2);
      assert.ok(result.body.orders.length <= 2);
      seen.push(...result.body.orders.map((order: OrderRow) => order.id));
      cursor = result.body.pagination.next_cursor;
      if (page === 0) insert('m_a_inserted', 'm_a', buyer, 1000, 'sale', 'completed', '2026-11-04 00:00:00');
      if (!cursor) break;
    }
    assert.equal(cursor, null, 'Pagination must terminate');
    assert.deepEqual(seen, expected);
    assert.equal(new Set(seen).size, seen.length);
    db.prepare('DELETE FROM orders WHERE id = ?').run('m_a_inserted');
  }
});

test('search: rejects a cursor reused with a different merchant or filter', async () => {
  const first = await search('limit=1&type=sale');
  const cursor = first.body.pagination.next_cursor;
  assert.equal(typeof cursor, 'string');
  for (const [query, merchant] of [
    [`type=sale&cursor=${cursor}`, 'm_b'],
    [`type=refund&cursor=${cursor}`, 'm_a'],
    [`cursor=${cursor}`, 'm_a'],
  ]) {
    const result = await search(query, merchant);
    assert.equal(result.status, 400);
    assert.equal(result.body.error, 'invalid_search_query');
  }
  // Changing the page size keeps the same result set and is allowed.
  const next = await search(`type=sale&limit=2&cursor=${cursor}`);
  assert.equal(next.status, 200);
  assert.deepEqual(next.body.orders.map((order: OrderRow) => order.id), ['m_a_last', 'm_a_other']);
});

test('search: default and maximum page sizes remain bounded on larger result sets', async () => {
  for (let i = 0; i < 125; i++) {
    insert(`bulk_${String(i).padStart(3, '0')}`, 'm_a', buyer, i + 1, 'sale', 'completed', '2026-11-05 00:00:00');
  }
  for (const [query, size] of [['', 20], ['limit=100', 100]] as const) {
    const result = await search(query);
    assert.equal(result.status, 200);
    assert.equal(result.body.orders.length, size);
    assert.equal(result.body.pagination.limit, size);
    assert.equal(typeof result.body.pagination.next_cursor, 'string');
  }
});

test('search: invalid filters return actionable 400 errors instead of silently dropping constraints', async () => {
  const queries = [
    'customer_email=buyer', 'customer_email=', 'customer_email=x%40example.com&customer_email=y%40example.com',
    'customer_email[$ne]=x', 'status=', 'status=completed%20OR%201', `status=${'a'.repeat(65)}`,
    'type=chargeback', 'type=Sale', 'type=sale&type=refund', 'type[x]=sale',
    'from=2026-02-30', 'to=2026-13-01', 'from=2025-02-29', 'from=2026-1-01',
    'from=2026-11-01T00%3A00%3A00Z', 'from=2026-11-02&to=2026-11-02',
    'from=2026-11-03&to=2026-11-02', 'to=',
    'min_amount=-1', 'min_amount=0.5', 'max_amount=1e3', 'min_amount=NaN',
    `max_amount=${Number.MAX_SAFE_INTEGER + 1}`, 'min_amount=1001&max_amount=1000',
    'limit=0', 'limit=-1', 'limit=101', 'limit=1.5', 'limit=abc', 'limit=', 'limit=1&limit=2',
    'cursor=broken', 'cursor=e30', 'cursor=abcd%3D', 'sort=asc', 'page=2',
  ];
  for (const query of queries) {
    const result = await search(query);
    assert.equal(result.status, 400, query);
    assert.equal(result.body.error, 'invalid_search_query', query);
    assert.equal(typeof result.body.detail, 'string', query);
    assert.equal(result.body.orders, undefined, query);
  }
});

test('search: missing, malformed and unknown merchants receive 401, while an empty merchant gets 200', async () => {
  for (const [merchant, error] of [
    [null, 'missing_merchant_id'], ['', 'missing_merchant_id'],
    ['invalid/id', 'invalid_merchant_id'], ['m_unknown', 'invalid_merchant_id'],
  ] as const) {
    const result = await search('type=refund', merchant);
    assert.deepEqual(result, { status: 401, body: { error } });
  }
  assert.deepEqual(await search('', 'm_empty'), {
    status: 200, body: { orders: [], pagination: { limit: 20, next_cursor: null } },
  });
});

test('search: legacy invalid timestamps sort last and cannot satisfy date filters', async () => {
  insert('m_a_invalid_date', 'm_a', buyer, 1000, 'sale', 'completed', 'not-a-date');
  await matches('', [...fixtures.map(([id]) => id), 'invalid_date']);
  await matches('to=2026-11-01', ['old']);
});
