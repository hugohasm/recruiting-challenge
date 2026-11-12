# API reference

This document describes the current implementation, including its limitations.
The default base URL is `http://localhost:3000`; `PORT` changes the listening port.
The dashboard is served at `/`, and the application API is under `/api`.

| Method | Path | Requires `X-Merchant-Id` | Success |
|---|---|---|---|
| GET | `/api/health` | No | `200` |
| GET | `/api/orders` | Yes | `200` |
| GET | `/api/orders/:id` | Yes | `200` |
| POST | `/api/orders` | Yes | `201` |
| GET | `/api/revenue` | Yes | `200` |
| GET | `/api/metrics/summary` | Yes | `200` |
| GET | `/api/metrics/top-customers` | Yes | `200` |

Application responses use `Content-Type: application/json; charset=utf-8`.
Unmatched routes and framework-generated responses have exceptions described
under [Errors and routing](#errors-and-routing).

## Headers and demo authentication

| Request header | Current behavior |
|---|---|
| `X-Merchant-Id` | Required for the orders, revenue and metrics resources. Must identify an existing merchant and match `^[A-Za-z0-9_-]+$`: ASCII letters, digits, underscores or hyphens. IDs are case-sensitive. |
| `Content-Type: application/json` | Send this for the JSON body of `POST /api/orders`. `application/json; charset=utf-8` also works. A body sent as `text/plain` is not parsed as JSON and order creation returns `400 invalid_body`. |
| `Accept` | Not required. These routes return JSON regardless of the requested response format. |
| `Authorization` | Not read by the authentication middleware. Sending a bearer token does not authenticate a caller or replace `X-Merchant-Id`. |

The seeded merchants are `m_acme` and `m_bistro`. An existing merchant with no
orders is also accepted. Missing or empty merchant headers return
`401 missing_merchant_id`; malformed or unknown IDs return
`401 invalid_merchant_id`.

The middleware selects the merchant from the header. A `merchant_id` query
parameter or body field cannot override it. Order reads, revenue and metrics
are scoped to that selected merchant. An order belonging to another merchant
has the same `404 not_found` response as a nonexistent order.

**This is demo authentication, not production authentication.** The client
chooses the header value. Anyone who supplies another existing merchant's ID
can act as that merchant; the existence check does not prove identity or
permission. There is no login, verified JWT, authenticated session or
user-to-merchant authorization check in this application.

Production authentication is not implemented. It would need to verify the
caller and authorize access to the selected merchant using trusted identity
and permissions. The current header and data-scoping checks alone do not
provide that protection.

## Errors and routing

Application error bodies have an `error` string. Only `missing_date_range`
adds a `detail` field.

| HTTP status | JSON body | When it occurs |
|---|---|---|
| `400` | `{"error":"invalid_body"}` | Invalid order-creation payload, or a JSON parsing error from the global body parser. |
| `400` | `{"error":"missing_date_range","detail":"from and to are required (YYYY-MM-DD)"}` | Revenue request with a missing, empty or non-string `from` or `to`. |
| `401` | `{"error":"missing_merchant_id"}` | Missing or empty merchant header on a protected resource. |
| `401` | `{"error":"invalid_merchant_id"}` | Merchant header has an invalid format or does not match a stored merchant. |
| `404` | `{"error":"not_found"}` | No order with that ID belongs to the selected merchant. |
| `500` | `{"error":"internal_error"}` | Errors forwarded to the error handler other than JSON parsing failures, including database/query failures. |

The global JSON parser runs **before** authentication and routing. Consequently,
a malformed JSON body can produce `400 invalid_body` even when the merchant
header is missing, or when the requested path has no matching route. JSON
primitives such as `null`, `true` or a string are also rejected by this parser.
An array can be parsed, but is rejected by order-creation validation.

The parser currently uses its default `100kb` body-size limit. Oversized JSON
and unsupported charsets currently become `500 internal_error` through the
error handler; they are not exposed as `413` or `415`. These are current error
mapping limitations. Global parser errors and `500 internal_error` can apply
to any endpoint in addition to its route-specific errors listed below.

There is no application-level JSON fallback for unknown routes or unsupported
methods. For example, `GET /api/unknown` and an authenticated
`DELETE /api/orders` return Express-generated **HTML with status 404**, not
the JSON `not_found` error above. Authentication still runs for unmatched
requests under the protected resource prefixes. There is no custom `405`
response. Express also handles `HEAD` for GET routes without a response body,
and generates `OPTIONS` responses; for `/api/orders`, an authenticated OPTIONS
request returns `200` with `Allow: GET,HEAD,POST` and the text `GET,HEAD,POST`.

## Order representation and units

| Field | JSON type | Meaning |
|---|---|---|
| `id` | string | Stored order identifier. POST generates a UUID; reads do not validate UUID syntax. |
| `merchant_id` | string | Merchant owning the order. POST derives this from the validated header. |
| `customer_email` | string | Customer email, stored as supplied; POST does not trim or lowercase it. |
| `total_amount` | number | Amount in cents. POST accepts only positive safe integers for both sales and refunds. |
| `type` | string | POST accepts `sale` or `refund`. |
| `status` | string | POST currently accepts only `completed`. |
| `created_at` | string | Stored creation timestamp; formats are described below. |

Reads return stored rows without revalidating historical data. The creation
rules above are enforced by the POST route, not by equivalent database CHECK
constraints. Older or directly inserted rows may not satisfy those rules.

`total_amount`, `revenue_cents`, `avg_order_value_cents` and `total_spent` are
in cents. The revenue response additionally includes `revenue`, calculated as
`revenue_cents / 100`. The API does not return a currency code; the dashboard
formats amounts as USD.

### Dates

- API-created orders use SQLite `CURRENT_TIMESTAMP`, for example
  `2026-11-01 12:00:00` (UTC, without a timezone suffix).
- Seeded orders use ISO UTC strings, for example `2026-11-01T12:00:00.000Z`.
- The API returns these strings as stored. There is no uniform timestamp
  serialization or timezone conversion in the routes.
- Date filtering compares stored text using `created_at >= from` and
  `created_at < to`. `from` is inclusive; `to` is exclusive. A date-only `to`
  excludes orders on that date.
- The documented request convention is `YYYY-MM-DD`, but the routes do not
  validate calendar dates, normalize timestamps or verify that `from < to`.
  Mixed stored timestamp formats can affect comparisons and sorting. Do not
  assume arbitrary timestamp/timezone inputs are normalized to equivalent
  instants.

The examples below use illustrative data: a sale of 10000 cents and a refund
of 2000 cents for `buyer@example.com` in `m_acme`, on November 1 and 2, 2026.
They do not describe the randomly generated seed data.

## GET /api/health

No merchant header, query parameters or request body are required.

**Success: `200`**

```json
{"ok": true}
```

This reports that the handler is responding; it does not query the database or
perform dependency health checks. There are no route-specific errors. The
global parsing/error behavior described above still applies if a body is sent.

## GET /api/orders

Lists orders belonging to the merchant selected by `X-Merchant-Id`.

| Query parameter | Required | Default | Current behavior |
|---|---|---|---|
| `from` | No | None | Lower date bound; applied only when both `from` and `to` are nonempty strings. |
| `to` | No | None | Exclusive upper date bound; applied only with a nonempty string `from`. |
| `limit` | No | `100` | A string value is converted with `Number()` and passed to SQLite LIMIT. Non-string values are ignored, using the default. |

If only one date is supplied, or either date is empty or parsed as a non-string,
**the entire date filter is ignored**. Repeated date query keys can produce
arrays and therefore cause this behavior. Invalid nonempty date strings are
not rejected with `400`; they are compared as text.

Orders are sorted by stored `created_at` descending. There is no secondary
sort key, so ties have no guaranteed ordering. There is no offset, page,
cursor, total count or next-page field. Other query parameters, including
email, type, status and `merchant_id`, are ignored.

`limit` has no validation or enforced maximum. `limit=0` or an empty `limit`
returns an empty list; a negative integer such as `-1` removes the limit.
Nonnumeric values such as `abc`, or fractional values such as `1.5`, cause
`500 internal_error`. Repeated `limit` keys are parsed as a non-string and
fall back to `100` on this endpoint.

**Success: `200`**, with an `orders` array. No matches produce `{"orders":[]}`.
For `?from=2026-11-01&to=2026-11-02&limit=10`:

```json
{
  "orders": [
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "merchant_id": "m_acme",
      "customer_email": "buyer@example.com",
      "total_amount": 10000,
      "type": "sale",
      "status": "completed",
      "created_at": "2026-11-01 12:00:00"
    }
  ]
}
```

**Errors:** `401 missing_merchant_id`, `401 invalid_merchant_id`, and
`500 internal_error` for query failures such as invalid limits. Global JSON
parsing failures can also return `400 invalid_body`.

## GET /api/orders/:id

Requires `X-Merchant-Id`. The path parameter `id` identifies a stored order;
it is looked up together with the selected merchant ID. There are no supported
query parameters or request body fields.

**Success: `200`**

```json
{
  "order": {
    "id": "11111111-1111-4111-8111-111111111111",
    "merchant_id": "m_acme",
    "customer_email": "buyer@example.com",
    "total_amount": 10000,
    "type": "sale",
    "status": "completed",
    "created_at": "2026-11-01 12:00:00"
  }
}
```

**Errors:** `401 missing_merchant_id`, `401 invalid_merchant_id`, or
`404 not_found` for both absent orders and orders belonging to another merchant.
No order fields are included in that 404 response. Global `400 invalid_body`
and `500 internal_error` behavior also applies.

## POST /api/orders

Requires `X-Merchant-Id` and a JSON object sent with
`Content-Type: application/json`. No query parameters are used.

| Body field | Required | Default | Accepted values |
|---|---|---|---|
| `customer_email` | Yes | None | Unquoted ASCII email address with a dotted domain; see syntax rules below. |
| `total_amount` | Yes | None | Positive safe integer in cents: `1` through `9007199254740991` (`Number.MAX_SAFE_INTEGER`). |
| `type` | No | `sale` | Exactly `sale` or `refund`. |
| `status` | No | `completed` | Exactly `completed`, the only status supported by the current creation flow. |

Email validation requires exactly one `@`, no whitespace, at most 254
characters overall, and at most 64 characters before `@`. The local part
consists of dot-separated, nonempty segments matching
``[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+``. Leading, trailing or consecutive dots are
rejected. The domain needs at least two nonempty labels, each at most 63
characters; labels contain ASCII letters, digits or hyphens and cannot begin
or end with a hyphen. This checks syntax, not deliverability.

Strings, booleans, zero, negative amounts, fractional cents, non-finite numbers
and unsafe integers are rejected as amounts. Refund amounts must also be
positive: their type supplies the subtraction in revenue calculations.
Explicit `null` is invalid for all four fields; defaults apply only when the
optional fields are omitted. Type and status values are case-sensitive.

Example request:

```json
{
  "customer_email": "buyer@example.com",
  "total_amount": 2000,
  "type": "refund",
  "status": "completed"
}
```

**Success: `201`**, with an `order` object containing all fields in the order
representation shown for GET by ID. The server generates the UUID and creation
timestamp and uses the merchant from the header. Additional body fields are
ignored, including client-supplied `id`, `merchant_id` and `created_at`.

The endpoint inserts a new row. It does not link a refund to an original sale,
change that sale, check the amount already refunded or provide an idempotency
key. Repeating a valid POST creates another order with a new ID.

**Errors:** `401 missing_merchant_id`, `401 invalid_merchant_id`,
`400 invalid_body` for invalid payloads/JSON, and `500 internal_error` for
unexpected storage errors or the non-parsing body-parser errors described
above. Rejected payloads do not insert an order. After JSON parsing succeeds,
merchant authentication runs before payload validation.

## GET /api/revenue

Requires `X-Merchant-Id`.

| Query parameter | Required | Current behavior |
|---|---|---|
| `from` | Yes | Nonempty string; inclusive lower bound. Request convention: `YYYY-MM-DD`. |
| `to` | Yes | Nonempty string; exclusive upper bound. Request convention: `YYYY-MM-DD`. |

There are no other supported filters. Missing, empty or non-string values
(including arrays from repeated date keys) return `400 missing_date_range`.
Nonempty values are not validated as dates. For example, `from=banana&to=pear`
is accepted and evaluated as a text range. Equal or reversed text bounds
produce an empty range rather than a validation error.

Revenue is the sum of sale amounts **minus** refund amounts for the selected
merchant and date range. Each row is counted on its own `created_at`; a refund
does not retroactively change the original sale's period. Unknown stored types
contribute zero. There is no status filter. The result may be negative when
refunds exceed sales in the period; an empty period returns zero.

**Success: `200`**, for `?from=2026-11-01&to=2026-12-01`:

```json
{
  "merchant_id": "m_acme",
  "from": "2026-11-01",
  "to": "2026-12-01",
  "revenue_cents": 8000,
  "revenue": 80
}
```

`from` and `to` echo the input strings. `revenue_cents` is the net amount in
cents; `revenue` is that value divided by 100.

**Errors:** `401 missing_merchant_id`, `401 invalid_merchant_id`,
`400 missing_date_range` with the exact body below, plus global
`400 invalid_body` and `500 internal_error` behavior.

```json
{
  "error": "missing_date_range",
  "detail": "from and to are required (YYYY-MM-DD)"
}
```

## GET /api/metrics/summary

Requires `X-Merchant-Id`. There are no supported query parameters or request
body fields. Metrics cover **all stored orders** for the selected merchant;
`from`, `to`, type and status query parameters do not filter them.

**Success: `200`**

```json
{
  "merchant_id": "m_acme",
  "total_orders": 2,
  "unique_customers": 1,
  "avg_order_value_cents": 6000
}
```

| Response field | Type | Current calculation |
|---|---|---|
| `merchant_id` | string | Merchant selected by the header. |
| `total_orders` | number | Count of all order rows, including sale and refund rows. |
| `unique_customers` | number | Count of distinct stored email strings; no email normalization, with case-sensitive comparison. |
| `avg_order_value_cents` | number | Average of stored `total_amount` across all order rows, rounded with `Math.round`, in cents. |

Refunds currently contribute their **positive** amounts to this average. This
is not a net-sales average and is not restricted to sale rows or any status.
For a merchant without orders, all three numeric fields are `0`.

**Errors:** `401 missing_merchant_id`, `401 invalid_merchant_id`,
`500 internal_error` on database/query failure, and global
`400 invalid_body` for JSON parsing failures.

## GET /api/metrics/top-customers

Requires `X-Merchant-Id`.

| Query parameter | Required | Default | Current behavior |
|---|---|---|---|
| `limit` | No | `5` | Converted with `Number()` and passed to SQLite LIMIT, without type/range validation or an enforced maximum. |

Unlike the orders list, this conversion is also attempted for non-string query
values. For example, `limit=1&limit=2` produces `500 internal_error` here.
`limit=0` or an empty `limit` returns no customers; a negative integer such as
`-1` removes the limit. Nonnumeric or fractional limits also produce
`500 internal_error`.

Other query parameters are ignored. Results cover all stored order rows for
the selected merchant and group by the exact, case-sensitive email string.
They are sorted by `total_spent` descending, with no guaranteed tie-breaker
and no pagination metadata.

**Success: `200`**

```json
{
  "customers": [
    {
      "customer_email": "buyer@example.com",
      "order_count": 2,
      "total_spent": 12000
    }
  ]
}
```

| Customer field | Type | Current calculation |
|---|---|---|
| `customer_email` | string | Stored email used as the grouping key. |
| `order_count` | number | Count of all rows for that email, including refunds. |
| `total_spent` | number | Sum of stored `total_amount`, **in cents**, including refund amounts positively. |

Despite the field name, `total_spent` is not net spend. In this example it is
12000 cents, while the revenue endpoint returns 8000 cents for the same sale
and refund. No type or status filter is applied. No matching customers produces
`{"customers":[]}`.

**Errors:** `401 missing_merchant_id`, `401 invalid_merchant_id`,
`500 internal_error` for query failures such as invalid limits, and global
`400 invalid_body` for JSON parsing failures.

## Implementation references

- [Server routes and middleware order](../src/server.ts)
- [Demo authentication](../src/auth.ts)
- [Error responses](../src/error-handler.ts)
- [Order routes and payload validation](../src/routes/orders.ts)
- [Order queries and net revenue calculation](../src/dal/orders-dal.ts)
- [Revenue route](../src/routes/revenue.ts)
- [Metrics calculations](../src/routes/metrics.ts)
- [Schema and timestamp defaults](../src/db.ts)
- [Seeded timestamp format](../src/scripts/seed.ts)
