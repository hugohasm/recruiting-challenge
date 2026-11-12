import { Router } from 'express';
import { ordersDal } from '../dal/orders-dal.js';

export const revenueRouter = Router();

/**
 * GET /api/revenue?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Returns net revenue for the authenticated merchant in the given date range.
 */
revenueRouter.get('/', (req, res) => {
  const from = typeof req.query.from === 'string' ? req.query.from : undefined;
  const to = typeof req.query.to === 'string' ? req.query.to : undefined;
  if (!from || !to) {
    res.status(400).json({ error: 'missing_date_range', detail: 'from and to are required (YYYY-MM-DD)' });
    return;
  }

  const total = ordersDal.sumAmountByMerchant(req.merchantId!, from, to);
  res.json({
    merchant_id: req.merchantId,
    from,
    to,
    revenue_cents: total,
    revenue: total / 100,
  });
});
