import { Router } from 'express';
import { ordersDal, type OrderSearchCursor, type OrderSearchFilters } from '../dal/orders-dal.js';
import { createHash, randomUUID } from 'node:crypto';

function isValidEmail(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 254 || /\s/.test(value)) return false;
  const [local, domain, ...extra] = value.split('@');
  if (!local || !domain || extra.length > 0 || local.length > 64) return false;

  const validLocal = local.split('.').every((part) => /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+$/.test(part));
  const labels = domain.split('.');
  return validLocal && labels.length >= 2 && labels.every((label) =>
    label.length <= 63 && /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label),
  );
}

export const ordersRouter = Router();

const searchParameters = new Set([
  'customer_email', 'status', 'type', 'from', 'to', 'min_amount', 'max_amount', 'limit', 'cursor',
]);

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

// Keep the literal search route before /:id.
ordersRouter.get('/search', (req, res) => {
  const invalid = (detail: string) => {
    res.status(400).json({ error: 'invalid_search_query', detail });
  };
  for (const [name, value] of Object.entries(req.query)) {
    if (!searchParameters.has(name)) return invalid(`Unsupported query parameter: ${name}.`);
    if (typeof value !== 'string' || value.length === 0) {
      return invalid(`${name} must be a single nonempty value.`);
    }
  }
  const query = req.query as Record<string, string | undefined>;
  const filters: OrderSearchFilters = {};
  if (query.customer_email !== undefined) {
    if (!isValidEmail(query.customer_email)) return invalid('Enter a valid customer email.');
    filters.customerEmail = query.customer_email.toLowerCase();
  }
  if (query.status !== undefined) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(query.status)) {
      return invalid('Status must contain 1–64 letters, digits, underscores or hyphens, starting with a letter.');
    }
    filters.status = query.status;
  }
  if (query.type !== undefined) {
    if (query.type !== 'sale' && query.type !== 'refund') return invalid('Type must be sale or refund.');
    filters.type = query.type;
  }
  for (const name of ['from', 'to'] as const) {
    if (query[name] !== undefined) {
      if (!isCalendarDate(query[name])) return invalid(`${name} must be a valid date in YYYY-MM-DD format.`);
      filters[name] = query[name];
    }
  }
  if (filters.from && filters.to && filters.from >= filters.to) {
    return invalid('From must be earlier than Before; the end date is excluded.');
  }
  for (const [name, field] of [['min_amount', 'minAmount'], ['max_amount', 'maxAmount']] as const) {
    const value = query[name];
    if (value !== undefined) {
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
        return invalid(`${name} must be a non-negative safe integer in cents.`);
      }
      filters[field] = Number(value);
    }
  }
  if (filters.minAmount !== undefined && filters.maxAmount !== undefined && filters.minAmount > filters.maxAmount) {
    return invalid('Minimum amount must not exceed maximum amount.');
  }
  const limit = query.limit === undefined ? 20 : Number(query.limit);
  if ((query.limit !== undefined && !/^\d+$/.test(query.limit)) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    return invalid('Limit must be an integer between 1 and 100.');
  }

  // Binding prevents accidental reuse after changing filters or merchants; this is not an auth token.
  const scope = createHash('sha256').update(JSON.stringify([req.merchantId, filters])).digest('hex');
  let cursor: OrderSearchCursor | undefined;
  if (query.cursor !== undefined) {
    try {
      if (query.cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(query.cursor)) throw new Error('invalid_cursor');
      const decoded = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'));
      if (!decoded || decoded.v !== 1 || decoded.scope !== scope ||
          typeof decoded.createdAt !== 'number' || !Number.isFinite(decoded.createdAt) ||
          typeof decoded.id !== 'string' || decoded.id.length === 0 || decoded.id.length > 256) {
        throw new Error('invalid_cursor');
      }
      cursor = { createdAt: decoded.createdAt, id: decoded.id };
    } catch {
      return invalid('Invalid cursor. Start a new search with these filters and merchant.');
    }
  }
  const result = ordersDal.searchByMerchant(req.merchantId!, filters, limit, cursor);
  res.json({
    orders: result.orders,
    pagination: {
      limit,
      next_cursor: result.nextCursor
        ? Buffer.from(JSON.stringify({ v: 1, scope, ...result.nextCursor })).toString('base64url')
        : null,
    },
  });
});

ordersRouter.get('/', (req, res) => {
  const orders = ordersDal.listByMerchant(req.merchantId!, {
    from: typeof req.query.from === 'string' ? req.query.from : undefined,
    to: typeof req.query.to === 'string' ? req.query.to : undefined,
    limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined,
  });
  res.json({ orders });
});

ordersRouter.get('/:id', (req, res) => {
  const order = ordersDal.getById(req.merchantId!, req.params.id);
  if (!order) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.json({ order });
});

ordersRouter.post('/', (req, res) => {
  const body: unknown = req.body;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    res.status(400).json({ error: 'invalid_body' });
    return;
  }
  const { customer_email, total_amount, type = 'sale', status = 'completed' } = body as Record<string, unknown>;
  if (!isValidEmail(customer_email) ||
      typeof total_amount !== 'number' || !Number.isSafeInteger(total_amount) || total_amount <= 0 ||
      (type !== 'sale' && type !== 'refund') || status !== 'completed') {
    res.status(400).json({ error: 'invalid_body' });
    return;
  }
  const order = ordersDal.create({
    id: randomUUID(),
    merchant_id: req.merchantId!,
    customer_email,
    total_amount,
    type,
    status,
  });
  res.status(201).json({ order });
});
