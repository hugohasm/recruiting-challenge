# API reference

> Quick-and-dirty. Not complete.

All endpoints except `/api/health` require the `X-Merchant-Id` header.
It must identify an existing merchant and contain only ASCII letters, digits,
underscores or hyphens. Missing or empty headers return `401` with
`{ error: 'missing_merchant_id' }`; invalid or unknown IDs return `401` with
`{ error: 'invalid_merchant_id' }`.

This is the challenge's demo authentication: validating the header does not prove
the caller's identity. Production requires verified authentication.

## `GET /api/health`
No auth. Returns `{ ok: true }`.

## `GET /api/orders`
List orders for the authenticated merchant. Optional query: `from`, `to`, `limit`.

## `GET /api/orders/:id`
Get a single order by ID for the merchant identified by the header.
Returns `200` with `{ order }` for an owned order. Missing orders and orders
belonging to another merchant both return `404` with `{ error: 'not_found' }`.

## `POST /api/orders`
Body: `{ customer_email, total_amount, type?, status? }` (a JSON object).

- `customer_email`: an unquoted ASCII email address with a dotted domain, no
  whitespace, at most 254 characters, a local part up to 64 characters and
  domain labels up to 63 characters. Syntax is validated; delivery is not checked.
- `total_amount`: a positive safe integer in cents (`1` through
  `Number.MAX_SAFE_INTEGER`). This applies to both sales and refunds: never send
  negative amounts or fractional cents.
- `type`: `sale` or `refund`; defaults to `sale` when omitted.
- `status`: only `completed` is supported by the current creation flow;
  defaults to `completed` when omitted. Other statuses are rejected.

Returns `201` with `{ order }`. Invalid payloads (including explicit `null`
values for these fields and malformed JSON) return `400` with
`{ error: 'invalid_body' }` and do not insert an order.

## `GET /api/revenue?from=...&to=...`
Net revenue for the merchant: sum of sales minus sum of refunds, using the
existing date range (`from` inclusive, `to` exclusive). A refund is counted on
its own `created_at` date. The result can be negative when refunds exceed sales
in the period; an empty period returns zero.

The response keeps `revenue_cents` in cents and `revenue = revenue_cents / 100`.
For example, a sale of `10000` cents and a refund of `2000` cents produce
`revenue_cents: 8000` and `revenue: 80`.

## `GET /api/metrics/summary`
TODO: document fields.

## `GET /api/metrics/top-customers`
TODO: document fields.
