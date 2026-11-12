# Architecture (DRAFT — needs love)

> This file was started a while ago and hasn't been kept up to date.
> Treat as partial. Update what you change.

## Modules

- **`server.ts`** — Express bootstrapper. Wires routers to paths.
- **`db.ts`** — SQLite connection + schema init. Single shared `db` instance.
- **`auth.ts`** — request authentication. Today: trusts `X-Merchant-Id` header.
  Eventually this becomes a real signed token; the header shape is a placeholder.
- **`dal/`** — data-access layer. The intent is that all order queries route
  through `ordersDal` so we have one place to add auditing, caching, tenancy
  filters, etc. (Not all routes follow this yet — see `metrics.ts`.)
- **`routes/`** — Express routers, one file per resource.
- **`lib/`** — utilities. Empty at the moment but reserved for shared helpers.

## Data model

Two tables: `merchants`, `orders`. See `db.ts` for the canonical DDL.

`orders.type` is one of `'sale' | 'refund'`. A refund row records that a sale
was reversed; it does not by itself reverse the sale row.
Both types use positive integer amounts in cents. The revenue endpoint subtracts
refunds from sales within the requested merchant and date range. Order creation
currently supports only the `completed` status.

## Order search

`GET /api/orders/search` validates query parameters in `routes/orders.ts`, then
calls `ordersDal.searchByMerchant`. Every search includes the merchant selected
by the existing demo-auth middleware. Values are bound SQL parameters; request
input never supplies column names or SQL operators. The literal search route
is registered before the order-ID route.

Search normalizes the two existing timestamp formats using `julianday` and
orders by time and ID descending. Cursor pagination reads at most `limit + 1`
matching rows to determine whether another page exists; it does not run COUNT
or OFFSET. A cursor carries the last row's sort keys and a hash of merchant and
filters to reject accidental reuse with a different search. This hash is not
an authentication credential; merchant scoping is enforced separately in SQL.

Schema initialization adds two expression indexes: merchant/time/ID, and
merchant/case-insensitive email/time/ID. The explicit cursor time bound enables
an indexed range search, and the indexes supply the requested sort order.
There are no new tables or columns and no rewrite of stored timestamps.
Status, type and amount remain residual filters: selective searches can scan
many entries within the merchant/date/email range. Large equal-timestamp groups
can also require scanning ties on later pages. Index space and write cost are
the tradeoff; this is not a constant-cost guarantee for every filter combination.

`public/index.html` and `public/app.js` provide the filter form and cursor
history for Previous/Next. The UI converts dollar strings to integer cents,
renders values as text, cancels superseded searches and ignores stale responses.
Search filters affect the orders table; summary metrics retain their existing
merchant-wide behavior. No frontend dependencies were added.

## Open items

- ~~Wire `dashboard.tsx` once we pick a frontend framework~~ — went with static HTML+fetch instead. Doc stale.
- Decide whether `analytics-events` is its own service or a route here.
- Audit logging — TBD where it lives.
