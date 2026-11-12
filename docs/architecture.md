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

## Open items

- ~~Wire `dashboard.tsx` once we pick a frontend framework~~ — went with static HTML+fetch instead. Doc stale.
- Decide whether `analytics-events` is its own service or a route here.
- Audit logging — TBD where it lives.
