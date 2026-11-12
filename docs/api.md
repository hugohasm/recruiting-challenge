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
Body: `{ customer_email, total_amount, type? }`.

## `GET /api/revenue?from=...&to=...`
Total revenue for the merchant in the date range.

## `GET /api/metrics/summary`
TODO: document fields.

## `GET /api/metrics/top-customers`
TODO: document fields.
