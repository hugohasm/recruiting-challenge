import { db } from '../db.js';

export interface OrderRow {
  id: string;
  merchant_id: string;
  customer_email: string;
  total_amount: number;
  type: 'sale' | 'refund';
  status: string;
  created_at: string;
}

export interface OrderSearchFilters {
  customerEmail?: string;
  status?: string;
  type?: 'sale' | 'refund';
  from?: string;
  to?: string;
  minAmount?: number;
  maxAmount?: number;
}

export interface OrderSearchCursor {
  createdAt: number;
  id: string;
}

/**
 * Data-access layer for orders. All order queries should go through here.
 *
 * - centralized place for query patterns
 * - the place to add auditing, caching, tenancy filters
 * - the seam for swapping the underlying store
 */
export const ordersDal = {
  searchByMerchant(merchantId: string, filters: OrderSearchFilters, limit: number, cursor?: OrderSearchCursor) {
    const time = 'COALESCE(julianday(created_at), 0)';
    const conditions = ['merchant_id = ?'];
    const values: Array<string | number> = [merchantId];
    if (filters.customerEmail !== undefined) {
      conditions.push('customer_email = ? COLLATE NOCASE');
      values.push(filters.customerEmail);
    }
    if (filters.status !== undefined) {
      conditions.push('status = ?');
      values.push(filters.status);
    }
    if (filters.type !== undefined) {
      conditions.push('type = ?');
      values.push(filters.type);
    }
    if (filters.from !== undefined || filters.to !== undefined) {
      conditions.push('julianday(created_at) IS NOT NULL');
    }
    if (filters.from !== undefined) {
      conditions.push(`${time} >= julianday(?)`);
      values.push(filters.from);
    }
    if (filters.to !== undefined) {
      conditions.push(`${time} < julianday(?)`);
      values.push(filters.to);
    }
    if (filters.minAmount !== undefined) {
      conditions.push('total_amount >= ?');
      values.push(filters.minAmount);
    }
    if (filters.maxAmount !== undefined) {
      conditions.push('total_amount <= ?');
      values.push(filters.maxAmount);
    }
    if (cursor) {
      // The explicit time bound lets SQLite seek into the expression index.
      conditions.push(`${time} <= ? AND (${time}, id) < (?, ?)`);
      values.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
    const rows = db.prepare(`
      SELECT *, ${time} AS search_time FROM orders
      WHERE ${conditions.join(' AND ')}
      ORDER BY ${time} DESC, id DESC LIMIT ?
    `).all(...values, limit + 1) as Array<OrderRow & { search_time: number }>;
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      orders: page.map(({ search_time, ...order }) => order),
      nextCursor: hasMore && last ? { createdAt: last.search_time, id: last.id } : null,
    };
  },

  listByMerchant(merchantId: string, opts: { from?: string; to?: string; limit?: number } = {}): OrderRow[] {
    const limit = opts.limit ?? 100;
    if (opts.from && opts.to) {
      return db
        .prepare(
          `SELECT * FROM orders
           WHERE merchant_id = ? AND created_at >= ? AND created_at < ?
           ORDER BY created_at DESC
           LIMIT ?`,
        )
        .all(merchantId, opts.from, opts.to, limit) as OrderRow[];
    }
    return db
      .prepare(`SELECT * FROM orders WHERE merchant_id = ? ORDER BY created_at DESC LIMIT ?`)
      .all(merchantId, limit) as OrderRow[];
  },

  getById(merchantId: string, id: string): OrderRow | undefined {
    return db
      .prepare(`SELECT * FROM orders WHERE merchant_id = ? AND id = ?`)
      .get(merchantId, id) as OrderRow | undefined;
  },

  create(order: Omit<OrderRow, 'created_at'>): OrderRow {
    db.prepare(
      `INSERT INTO orders (id, merchant_id, customer_email, total_amount, type, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(order.id, order.merchant_id, order.customer_email, order.total_amount, order.type, order.status);
    return this.getById(order.merchant_id, order.id)!;
  },

  /**
   * Net revenue in cents: sales minus refunds over a date range for a merchant.
   * Both types store positive total_amount values.
   * Used by the revenue endpoint.
   */
  sumAmountByMerchant(merchantId: string, from: string, to: string): number {
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(CASE type
           WHEN 'sale' THEN total_amount
           WHEN 'refund' THEN -total_amount
           ELSE 0
         END), 0) AS total
         FROM orders
         WHERE merchant_id = ? AND created_at >= ? AND created_at < ?`,
      )
      .get(merchantId, from, to) as { total: number };
    return row.total;
  },
};
