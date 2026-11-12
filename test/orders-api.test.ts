import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import express from 'express';
import { initSchema, db } from '../src/db.js';
import { authMiddleware } from '../src/auth.js';
import { ordersDal } from '../src/dal/orders-dal.js';
import { ordersRouter } from '../src/routes/orders.js';

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

async function request(path: string, merchantId?: string, method = 'GET') {
  const headers: Record<string, string> = {};
  if (merchantId !== undefined) headers['X-Merchant-Id'] = merchantId;
  if (method === 'POST') headers['Content-Type'] = 'application/json';
  const response = await fetch(`${origin}${path}`, {
    method,
    headers,
    body: method === 'POST'
      ? JSON.stringify({ customer_email: 'new@example.com', total_amount: 2000 })
      : undefined,
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

  const path = `/api/orders/${created.body.order.id}`;
  assert.equal((await request(path, 'm_acme')).status, 200);
  assert.deepEqual(await request(path, 'm_bistro'), {
    status: 404,
    body: { error: 'not_found' },
  });
});
