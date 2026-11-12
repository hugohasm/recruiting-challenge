import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import express from 'express';
import { initSchema, db } from '../src/db.js';
import { authMiddleware } from '../src/auth.js';
import { ordersDal } from '../src/dal/orders-dal.js';
import { ordersRouter } from '../src/routes/orders.js';
import { revenueRouter } from '../src/routes/revenue.js';
import { errorHandler } from '../src/error-handler.js';

let server: Server | undefined;
let origin: string;

before(async () => {
  initSchema();
  for (const merchantId of ['m_acme', 'm_bistro']) {
    db.prepare('INSERT INTO merchants (id, name) VALUES (?, ?)').run(merchantId, merchantId);
    ordersDal.create({
      id: `o_${merchantId}`,
      merchant_id: merchantId,
      customer_email: `${merchantId}@example.com`,
      total_amount: 1000,
      type: 'sale',
      status: 'completed',
    });
  }

  const app = express();
  app.use(express.json());
  app.use('/api/orders', authMiddleware, ordersRouter);
  app.use('/api/revenue', authMiddleware, revenueRouter);
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server?.listening) {
    await new Promise<void>((resolve, reject) => {
      server!.close((error) => error ? reject(error) : resolve());
    });
  }
  db.close();
});

async function request(
  path: string,
  merchantId?: string,
  method = 'GET',
  payload: unknown = { customer_email: 'new@example.com', total_amount: 2000 },
) {
  const headers: Record<string, string> = {};
  if (merchantId !== undefined) headers['X-Merchant-Id'] = merchantId;
  if (method === 'POST') headers['Content-Type'] = 'application/json';
  const response = await fetch(`${origin}${path}`, {
    method,
    headers,
    body: method === 'POST' ? JSON.stringify(payload) : undefined,
    signal: AbortSignal.timeout(5000),
  });
  return { status: response.status, body: await response.json() };
}

for (const [merchantId, otherMerchantId] of [['m_acme', 'm_bistro'], ['m_bistro', 'm_acme']] as const) {
  test(`orders API: ${merchantId} can read its own order`, async () => {
    const { status, body } = await request(`/api/orders/o_${merchantId}`, merchantId);
    assert.equal(status, 200);
    assert.equal(body.order.id, `o_${merchantId}`);
    assert.equal(body.order.merchant_id, merchantId);
  });

  test(`orders API: ${merchantId} cannot read ${otherMerchantId}'s order`, async () => {
    const result = await request(`/api/orders/o_${otherMerchantId}`, merchantId);
    assert.deepEqual(result, { status: 404, body: { error: 'not_found' } });
  });
}

test('orders API: a missing order returns the same 404 as a foreign order', async () => {
  const result = await request('/api/orders/o_missing', 'm_acme');
  assert.deepEqual(result, { status: 404, body: { error: 'not_found' } });
});

for (const merchantId of [undefined, '', '   ', 'm_unknown', 'm acme', 'm_acme,m_bistro', "m_acme' OR 1=1 --"]) {
  test(`orders API: rejects missing, unknown or invalid merchant ${JSON.stringify(merchantId)}`, async () => {
    const { status, body } = await request('/api/orders/o_m_acme', merchantId);
    assert.equal(status, 401);
    assert.equal('order' in body, false);
  });
}

test('orders API: an unknown merchant cannot list or create orders', async () => {
  const countBefore = db.prepare('SELECT COUNT(*) AS n FROM orders').get();
  for (const method of ['GET', 'POST']) {
    const result = await request('/api/orders', 'm_unknown', method);
    assert.deepEqual(result, { status: 401, body: { error: 'invalid_merchant_id' } });
  }
  assert.deepEqual(db.prepare('SELECT COUNT(*) AS n FROM orders').get(), countBefore);
});

test('orders API: a newly created order is readable only by its merchant', async () => {
  const created = await request('/api/orders', 'm_acme', 'POST');
  assert.equal(created.status, 201);
  assert.equal(created.body.order.merchant_id, 'm_acme');
  assert.equal(created.body.order.type, 'sale');
  assert.equal(created.body.order.status, 'completed');

  const path = `/api/orders/${created.body.order.id}`;
  assert.equal((await request(path, 'm_acme')).status, 200);
  assert.deepEqual(await request(path, 'm_bistro'), {
    status: 404,
    body: { error: 'not_found' },
  });
});

const validPayload = { customer_email: 'buyer@example.com', total_amount: 1000 };

const invalidPayloads: Array<[string, unknown]> = [
  ['null body', null],
  ['array body', []],
  ['empty body', {}],
  ['missing email', { total_amount: 1000 }],
  ['empty email', { ...validPayload, customer_email: '' }],
  ['non-string email', { ...validPayload, customer_email: { address: 'buyer@example.com' } }],
  ['missing email domain', { ...validPayload, customer_email: 'buyer@' }],
  ['missing email at sign', { ...validPayload, customer_email: 'buyer.example.com' }],
  ['multiple email at signs', { ...validPayload, customer_email: 'buyer@@example.com' }],
  ['email whitespace', { ...validPayload, customer_email: 'buyer @example.com' }],
  ['email newline in local part', { ...validPayload, customer_email: 'buyer\n@example.com' }],
  ['email newline in domain', { ...validPayload, customer_email: 'buyer@example.com\n' }],
  ['email without domain suffix', { ...validPayload, customer_email: 'buyer@example' }],
  ['email HTML', { ...validPayload, customer_email: '<img src=x onerror=alert(1)>@example.com' }],
  ['email local part with consecutive dots', { ...validPayload, customer_email: 'buyer..test@example.com' }],
  ['email local part over 64 characters', { ...validPayload, customer_email: `${'a'.repeat(65)}@example.com` }],
  ['email domain label over 63 characters', { ...validPayload, customer_email: `buyer@${'a'.repeat(64)}.com` }],
  ['email domain label starting with hyphen', { ...validPayload, customer_email: 'buyer@-example.com' }],
  ['email over 254 characters', { ...validPayload, customer_email: `${'a'.repeat(64)}@${Array(4).fill('b'.repeat(47)).join('.')}` }],
  ['missing amount', { customer_email: 'buyer@example.com' }],
  ['string amount', { ...validPayload, total_amount: '1000' }],
  ['null amount', { ...validPayload, total_amount: null }],
  ['boolean amount', { ...validPayload, total_amount: true }],
  ['zero amount', { ...validPayload, total_amount: 0 }],
  ['negative sale amount', { ...validPayload, total_amount: -1000 }],
  ['negative refund amount', { ...validPayload, total_amount: -1000, type: 'refund' }],
  ['fractional cents', { ...validPayload, total_amount: 12.34 }],
  ['unsafe integer amount', { ...validPayload, total_amount: Number.MAX_SAFE_INTEGER + 1 }],
  ['unknown type', { ...validPayload, type: 'chargeback' }],
  ['null type', { ...validPayload, type: null }],
  ['non-string type', { ...validPayload, type: ['sale'] }],
  ['unknown status', { ...validPayload, status: 'anything' }],
  ['unsupported status', { ...validPayload, status: 'pending' }],
  ['null status', { ...validPayload, status: null }],
  ['non-string status', { ...validPayload, status: ['completed'] }],
];

for (const [name, payload] of invalidPayloads) {
  test(`orders API: rejects ${name} without inserting an order`, async () => {
    const countBefore = db.prepare('SELECT COUNT(*) AS n FROM orders').get();
    assert.deepEqual(await request('/api/orders', 'm_acme', 'POST', payload), {
      status: 400,
      body: { error: 'invalid_body' },
    });
    assert.deepEqual(db.prepare('SELECT COUNT(*) AS n FROM orders').get(), countBefore);
  });
}

test('orders API: malformed JSON, primitives and non-finite amounts return 400', async () => {
  const countBefore = db.prepare('SELECT COUNT(*) AS n FROM orders').get();
  for (const body of ['{', 'true', '42', '"text"', '{"customer_email":"buyer@example.com","total_amount":1e400}']) {
    const response = await fetch(`${origin}/api/orders`, {
      method: 'POST',
      headers: { 'X-Merchant-Id': 'm_acme', 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 400, body);
    assert.deepEqual(await response.json(), { error: 'invalid_body' });
  }
  assert.deepEqual(db.prepare('SELECT COUNT(*) AS n FROM orders').get(), countBefore);
});

test('orders API: accepts valid email variants and positive safe integer cents', async () => {
  for (const [customer_email, total_amount] of [
    ['buyer+tag@example.com', 1],
    ["o'connor@shop.example.com", 101],
    ['First.Last@example.co.uk', Number.MAX_SAFE_INTEGER],
  ] as const) {
    const { status, body } = await request('/api/orders', 'm_acme', 'POST', {
      customer_email,
      total_amount,
      type: 'sale',
      status: 'completed',
    });
    assert.equal(status, 201);
    assert.equal(body.order.customer_email, customer_email);
    assert.equal(body.order.total_amount, total_amount);
    assert.equal(body.order.type, 'sale');
    assert.equal(body.order.status, 'completed');
  }
});

test('revenue API: a 10000-cent sale minus a 2000-cent refund returns 8000 cents', async () => {
  const merchantId = 'm_revenue';
  db.prepare('INSERT INTO merchants (id, name) VALUES (?, ?)').run(merchantId, 'Revenue');
  for (const [type, total_amount] of [['sale', 10000], ['refund', 2000]] as const) {
    const created = await request('/api/orders', merchantId, 'POST', {
      ...validPayload, type, total_amount, status: 'completed',
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.order.total_amount, total_amount);
    assert.equal(created.body.order.type, type);
  }
  const result = await request('/api/revenue?from=2000-01-01&to=2100-01-01', merchantId);
  assert.deepEqual(result, {
    status: 200,
    body: {
      merchant_id: merchantId,
      from: '2000-01-01',
      to: '2100-01-01',
      revenue_cents: 8000,
      revenue: 80,
    },
  });
});
