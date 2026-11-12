import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Exercise the shipped script's form events and fetches without adding a DOM dependency.
// Browser layout and native form validation are checked separately in the real dashboard.
class Control {
  value = '';
  private text = '';
  get textContent() { return this.text; }
  set textContent(value: unknown) { this.text = String(value); }
  disabled = false;
  children: Control[] = [];
  fields = new Map<string, string>();
  listeners = new Map<string, (event: { preventDefault(): void }) => void>();
  set innerHTML(_value: string) { throw new Error('Order values must be rendered as text'); }
  addEventListener(name: string, callback: (event: { preventDefault(): void }) => void) { this.listeners.set(name, callback); }
  trigger(name: string) { this.listeners.get(name)?.({ preventDefault() {} }); }
  appendChild(child: Control) { this.children.push(child); }
  replaceChildren() { this.children = []; }
  setAttribute(_name: string, _value: string) {}
  reset() { this.fields.clear(); }
}

interface PendingRequest {
  path: string;
  headers: Record<string, string>;
  signal?: AbortSignal;
  respond(body: unknown, status?: number): Promise<void>;
}

function dashboard() {
  const controls = new Map<string, Control>();
  const control = (id: string) => {
    if (!controls.has(id)) controls.set(id, new Control());
    return controls.get(id)!;
  };
  control('merchant-select').value = 'm_acme';
  const requests: PendingRequest[] = [];
  runInNewContext(readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'), {
    document: { getElementById: control, createElement: () => new Control() },
    URLSearchParams,
    AbortController,
    FormData: class {
      constructor(private form: Control) {}
      [Symbol.iterator]() { return this.form.fields.entries(); }
    },
    fetch: (path: string, options: { headers: Record<string, string>; signal?: AbortSignal }) => new Promise((resolve) => {
      requests.push({
        path, ...options,
        async respond(body, status = 200) {
          // Deliberately deliver even after abort to verify the stale-response guard too.
          resolve({ ok: status >= 200 && status < 300, json: async () => body });
          await new Promise<void>((done) => setImmediate(done));
        },
      });
    }),
  });
  return { control, requests };
}

const order = (email: string, merchantId: string) => ({
  id: email, merchant_id: merchantId, customer_email: email, total_amount: 29,
  type: 'sale', status: 'completed', created_at: '2026-11-01 00:00:00',
});
const page = (email: string, cursor: string | null = null, merchantId = 'm_acme') => ({
  orders: [order(email, merchantId)], pagination: { limit: 20, next_cursor: cursor },
});

test('search UI: combines form filters and sends exact cent bounds with the selected merchant', async () => {
  const { control, requests } = dashboard();
  control('order-search-form').fields = new Map(Object.entries({
    customer_email: 'buyer@example.com', status: 'completed', type: 'refund',
    from: '2026-11-01', to: '2026-11-03', min_amount: '0.29', max_amount: '10.01',
  }));
  control('order-search-form').trigger('submit');
  const request = requests.at(-1)!;
  const params = new URL(request.path, 'http://localhost').searchParams;
  assert.equal(request.headers['X-Merchant-Id'], 'm_acme');
  assert.deepEqual(Object.fromEntries(params), {
    customer_email: 'buyer@example.com', status: 'completed', type: 'refund',
    from: '2026-11-01', to: '2026-11-03', min_amount: '29', max_amount: '1001', limit: '20',
  });
  await request.respond(page('buyer@example.com'));
  assert.equal(control('orders-message').textContent, '1 order on this page.');
  assert.equal(control('orders-tbody').children[0]!.children[4]!.textContent, '$0.29');
});

test('search UI: late responses cannot show the previous merchant in orders or summary', async () => {
  const { control, requests } = dashboard();
  const [oldSummary, oldRevenue, oldOrders] = requests;
  control('merchant-select').value = 'm_bistro';
  control('merchant-select').trigger('change');
  const [newSummary, newRevenue, newOrders] = requests.slice(3);
  assert.ok(oldOrders!.signal!.aborted);
  assert.ok(requests.slice(3).every((request) => request.headers['X-Merchant-Id'] === 'm_bistro'));
  await newSummary!.respond({ total_orders: 2, unique_customers: 1, avg_order_value_cents: 200 });
  await newRevenue!.respond({ revenue_cents: 400 });
  await newOrders!.respond(page('bistro@example.com', null, 'm_bistro'));
  await oldSummary!.respond({ total_orders: 99, unique_customers: 99, avg_order_value_cents: 999 });
  await oldRevenue!.respond({ revenue_cents: 999 });
  await oldOrders!.respond(page('acme@example.com'));
  assert.equal(control('orders-tbody').children[0]!.children[1]!.textContent, 'bistro@example.com');
  assert.equal(control('total-orders').textContent, '2');
  assert.equal(control('revenue-30d').textContent, '$4.00');
});

test('search UI: pagination preserves filters and clearing resets the cursor and results', async () => {
  const { control, requests } = dashboard();
  control('order-search-form').fields.set('type', 'refund');
  control('order-search-form').trigger('submit');
  await requests.at(-1)!.respond(page('first@example.com', 'next-token'));
  assert.equal(control('next-page').disabled, false);
  control('next-page').trigger('click');
  const nextRequest = requests.at(-1)!;
  assert.deepEqual(Object.fromEntries(new URL(nextRequest.path, 'http://localhost').searchParams), {
    type: 'refund', limit: '20', cursor: 'next-token',
  });
  await nextRequest.respond(page('last@example.com'));
  assert.equal(control('page-info').textContent, 'Page 2');
  assert.equal(control('next-page').disabled, true);
  control('previous-page').trigger('click');
  assert.equal(new URL(requests.at(-1)!.path, 'http://localhost').searchParams.has('cursor'), false);
  await requests.at(-1)!.respond(page('first@example.com', 'next-token'));
  assert.equal(control('page-info').textContent, 'Page 1');
  control('clear-filters').trigger('click');
  assert.equal(requests.at(-1)!.path, '/api/orders/search?limit=20');
  assert.equal(control('orders-tbody').children.length, 0);
  await requests.at(-1)!.respond({ orders: [], pagination: { limit: 20, next_cursor: null } });
  assert.equal(control('orders-message').textContent, 'No orders match these filters.');
  assert.equal(control('previous-page').disabled, true);
  assert.equal(control('next-page').disabled, true);
});
