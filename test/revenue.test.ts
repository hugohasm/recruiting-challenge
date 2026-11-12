import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { db, initSchema } from '../src/db.js';
import { ordersDal, type OrderRow } from '../src/dal/orders-dal.js';

before(() => {
  initSchema();
  for (const merchantId of ['m_revenue', 'm_other']) {
    db.prepare('INSERT INTO merchants (id, name) VALUES (?, ?)').run(merchantId, merchantId);
  }
  const fixtures: Array<[string, string, OrderRow['type'], number, string]> = [
    ['before_sale', 'm_revenue', 'sale', 50000, '2026-01-01T23:59:59.000Z'],
    ['before_refund', 'm_revenue', 'refund', 9000, '2026-01-01T23:59:59.000Z'],
    ['sale', 'm_revenue', 'sale', 10000, '2026-01-02T00:00:00.000Z'],
    ['refund', 'm_revenue', 'refund', 2000, '2026-01-02T12:00:00.000Z'],
    ['other_sale', 'm_other', 'sale', 80000, '2026-01-02T12:00:00.000Z'],
    ['other_refund', 'm_other', 'refund', 5000, '2026-01-02T12:00:00.000Z'],
    ['after_sale', 'm_revenue', 'sale', 70000, '2026-01-03T00:00:00.000Z'],
    ['after_refund', 'm_revenue', 'refund', 3000, '2026-01-03T00:00:00.000Z'],
    ['refund_only', 'm_revenue', 'refund', 5000, '2026-01-04T12:00:00.000Z'],
  ];
  const insert = db.prepare(`
    INSERT INTO orders (id, merchant_id, type, total_amount, created_at, customer_email, status)
    VALUES (?, ?, ?, ?, ?, 'buyer@example.com', 'completed')
  `);
  for (const fixture of fixtures) insert.run(...fixture);
});

after(() => db.close());

test('revenue DAL: subtracts refunds within the merchant and half-open date range', () => {
  assert.equal(ordersDal.sumAmountByMerchant('m_revenue', '2026-01-02', '2026-01-03'), 8000);
  assert.equal(ordersDal.sumAmountByMerchant('m_other', '2026-01-02', '2026-01-03'), 75000);
});

test('revenue DAL: a period with only refunds has negative net revenue', () => {
  assert.equal(ordersDal.sumAmountByMerchant('m_revenue', '2026-01-04', '2026-01-05'), -5000);
});

test('revenue DAL: an empty period has zero revenue', () => {
  assert.equal(ordersDal.sumAmountByMerchant('m_revenue', '2026-02-01', '2026-02-02'), 0);
});

test('revenue DAL: each refund reduces net revenue by exactly its positive cent amount', () => {
  for (const refundCents of [1, 99, 100, 2000, 10000, 12000]) {
    const merchantId = `m_refund_${refundCents}`;
    db.prepare('INSERT INTO merchants (id, name) VALUES (?, ?)').run(merchantId, merchantId);
    ordersDal.create({
      id: `sale_${refundCents}`, merchant_id: merchantId, customer_email: 'buyer@example.com',
      total_amount: 10000, type: 'sale', status: 'completed',
    });
    const beforeRefund = ordersDal.sumAmountByMerchant(merchantId, '2000-01-01', '2100-01-01');
    assert.equal(beforeRefund, 10000);
    ordersDal.create({
      id: `refund_${refundCents}`, merchant_id: merchantId, customer_email: 'buyer@example.com',
      total_amount: refundCents, type: 'refund', status: 'completed',
    });
    const afterRefund = ordersDal.sumAmountByMerchant(merchantId, '2000-01-01', '2100-01-01');
    assert.equal(afterRefund, beforeRefund - refundCents);
    assert.ok(afterRefund < beforeRefund);
  }
});

test('revenue DAL: splitting refunds and reversing insertion order preserve net cents', () => {
  const sales = [10001, 99, 2500];
  const partitions = [[3000], [1, 99, 2900], [1500, 1500]];
  const insert = db.prepare(`
    INSERT INTO orders (id, merchant_id, type, total_amount, created_at, customer_email, status)
    VALUES (?, ?, ?, ?, '2026-03-01T12:00:00.000Z', 'shared@example.com', 'completed')
  `);
  let scenario = 0;
  for (const refunds of partitions) {
    for (const reverse of [false, true]) {
      const merchantId = `m_partition_${scenario++}`;
      db.prepare('INSERT INTO merchants (id, name) VALUES (?, ?)').run(merchantId, merchantId);
      const movements = [
        ...sales.map((amount) => ({ type: 'sale', amount })),
        ...refunds.map((amount) => ({ type: 'refund', amount })),
      ];
      if (reverse) movements.reverse();
      movements.forEach((movement, index) => {
        insert.run(`${merchantId}_${index}`, merchantId, movement.type, movement.amount);
      });
      assert.equal(ordersDal.sumAmountByMerchant(merchantId, '2026-03-01', '2026-03-02'), 9600);
    }
  }
});
