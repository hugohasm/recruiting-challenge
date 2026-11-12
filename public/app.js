const select = document.getElementById('merchant-select');
const totalOrdersEl = document.getElementById('total-orders');
const uniqueCustomersEl = document.getElementById('unique-customers');
const avgOrderEl = document.getElementById('avg-order');
const revenue30dEl = document.getElementById('revenue-30d');
const ordersTbody = document.getElementById('orders-tbody');
const searchForm = document.getElementById('order-search-form');
const ordersTable = document.getElementById('orders-table');
const ordersMessage = document.getElementById('orders-message');
const summaryMessage = document.getElementById('summary-message');
const previousPage = document.getElementById('previous-page');
const nextPage = document.getElementById('next-page');
const pageInfo = document.getElementById('page-info');
let filters = new URLSearchParams();
let pageCursors = [null];
let pageIndex = 0;
let nextCursor = null;
let ordersController;
let searchVersion = 0;
let summaryVersion = 0;

async function api(path, merchantId, signal) {
  const response = await fetch(path, { headers: { 'X-Merchant-Id': merchantId }, signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body.detail || body.error || 'Request failed.');
  return body;
}

function money(cents) {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

async function refreshSummary() {
  const version = ++summaryVersion;
  const merchantId = select.value;
  for (const element of [totalOrdersEl, uniqueCustomersEl, avgOrderEl, revenue30dEl]) element.textContent = '—';
  summaryMessage.textContent = '';
  const now = new Date();
  const thirtyAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  try {
    const [summary, revenue] = await Promise.all([
      api('/api/metrics/summary', merchantId),
      api(`/api/revenue?from=${isoDate(thirtyAgo)}&to=${isoDate(now)}`, merchantId),
    ]);
    if (version !== summaryVersion) return;
    totalOrdersEl.textContent = summary.total_orders;
    uniqueCustomersEl.textContent = summary.unique_customers;
    avgOrderEl.textContent = money(summary.avg_order_value_cents);
    revenue30dEl.textContent = money(revenue.revenue_cents);
  } catch {
    if (version === summaryVersion) summaryMessage.textContent = 'Could not load the summary. Try selecting the merchant again.';
  }
}

// Convert decimal dollars as strings so 0.29 becomes exactly 29 cents.
function amountInCents(value) {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error('Amounts must use dollars with at most two decimal places.');
  const [whole, fraction = ''] = value.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Amount exceeds the supported range.');
  return cents.toString();
}

function renderOrders(orders) {
  ordersTbody.replaceChildren();
  for (const order of orders) {
    const row = document.createElement('tr');
    const timestamp = order.created_at.includes(' ') ? order.created_at.replace(' ', 'T') + 'Z' : order.created_at;
    const date = new Date(timestamp);
    const dateLabel = Number.isNaN(date.getTime()) ? order.created_at : date.toLocaleDateString('en-US', { timeZone: 'UTC' });
    for (const value of [dateLabel, order.customer_email, order.status, order.type, money(order.total_amount)]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.appendChild(cell);
    }
    ordersTbody.appendChild(row);
  }
}

async function loadOrders(targetPage, cursor) {
  ordersController?.abort();
  ordersController = new AbortController();
  const version = ++searchVersion;
  const params = new URLSearchParams(filters);
  params.set('limit', '20');
  if (cursor) params.set('cursor', cursor);
  ordersTbody.replaceChildren();
  ordersTable.setAttribute('aria-busy', 'true');
  ordersMessage.textContent = 'Loading orders…';
  pageInfo.textContent = '';
  previousPage.disabled = true;
  nextPage.disabled = true;
  try {
    const result = await api(`/api/orders/search?${params}`, select.value, ordersController.signal);
    if (version !== searchVersion) return;
    pageIndex = targetPage;
    pageCursors = pageCursors.slice(0, targetPage + 1);
    pageCursors[targetPage] = cursor;
    nextCursor = result.pagination.next_cursor;
    renderOrders(result.orders);
    const count = result.orders.length;
    ordersMessage.textContent = count ? `${count} ${count === 1 ? 'order' : 'orders'} on this page.` : 'No orders match these filters.';
    pageInfo.textContent = `Page ${pageIndex + 1}`;
    previousPage.disabled = pageIndex === 0;
    nextPage.disabled = !nextCursor;
  } catch (error) {
    if (version !== searchVersion || error.name === 'AbortError') return;
    ordersMessage.textContent = `Could not load orders: ${error.message}`;
  } finally {
    if (version === searchVersion) ordersTable.setAttribute('aria-busy', 'false');
  }
}

function startSearch() {
  try {
    const nextFilters = new URLSearchParams();
    for (const [name, rawValue] of new FormData(searchForm)) {
      const value = rawValue.trim();
      if (value) nextFilters.set(name, name === 'min_amount' || name === 'max_amount' ? amountInCents(value) : value);
    }
    filters = nextFilters;
    pageCursors = [null];
    pageIndex = 0;
    nextCursor = null;
    loadOrders(0, null);
  } catch (error) {
    ordersController?.abort();
    ++searchVersion;
    ordersTbody.replaceChildren();
    ordersTable.setAttribute('aria-busy', 'false');
    previousPage.disabled = true;
    nextPage.disabled = true;
    pageInfo.textContent = '';
    ordersMessage.textContent = error.message;
  }
}

searchForm.addEventListener('submit', (event) => { event.preventDefault(); startSearch(); });
document.getElementById('clear-filters').addEventListener('click', () => { searchForm.reset(); startSearch(); });
previousPage.addEventListener('click', () => loadOrders(pageIndex - 1, pageCursors[pageIndex - 1]));
nextPage.addEventListener('click', () => loadOrders(pageIndex + 1, nextCursor));
select.addEventListener('change', () => { refreshSummary(); startSearch(); });
refreshSummary();
startSearch();
