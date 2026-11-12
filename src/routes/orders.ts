import { Router } from 'express';
import { ordersDal } from '../dal/orders-dal.js';
import { randomUUID } from 'node:crypto';

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
