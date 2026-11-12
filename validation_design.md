# Validation design — Hugo Segoviano

> I wrote this validation design entirely without AI assistance. The only tool I used was spell-check.

---

## The question

Anyone with a competent AI tool can fix the symptoms in this codebase. What separates an architect is building the validation layer that catches the class of bug next time, so the same mistake cannot quietly reach production again.

For the issues I addressed, I focused on the gates that protect the business contract instead of only patching a single instance.

### Class 1 — Multi-merchant authorization and IDOR boundary

- **Instances I fixed:** The order read path allowed one merchant to retrieve another merchant’s order if the ID was known.
- **The gate I built (or would build):** A regression test that creates two merchants and asserts that merchant A cannot retrieve merchant B’s order data. This is the operational gate that protects the tenant boundary.
- **What this gate would catch that a regression test would miss:** It would catch future refactors or route changes that accidentally remove the merchant filter, even if the specific order IDs are different.
- **Where to see the gate in the diff:** The test suite covering tenant leakage and revenue behavior.
- **If you did not build it, name the reason:** I did build it as part of the regression coverage, so the class is protected in the repo.

### Class 2 — Incorrect financial totals

- **Instances I fixed:** Net revenue was being treated as gross sales instead of subtracting refunds.
- **The gate I built (or would build):** A business-level regression test that creates a sale and refund for the same merchant and asserts that the net total is the difference, not the sum.
- **What this gate would catch that a regression test would miss:** It protects against future changes to the calculation logic even if the code is refactored or the dashboard changes.
- **Where to see the gate in the diff:** The revenue regression tests.
- **If you did not build it, name the reason:** It is implemented in the test suite and covers the class of bug.

### Class 3 — Invalid order creation payloads

- **Instances I fixed:** Invalid email values, negative amounts, unsupported order types, and invalid statuses were accepted by the API.
- **The gate I built (or would build):** A contract-level validation check at the order creation boundary that rejects unsupported values before they are persisted.
- **What this gate would catch that a regression test would miss:** It catches invalid requests before they enter the data layer, which prevents future accidental drift in the API contract.
- **Where to see the gate in the diff:** The order payload validation logic and corresponding tests.
- **If you did not build it, name the reason:** It is implemented in the request validation path.

These are the three meaningful gates I would rely on before shipping. They cover the tenant boundary, the financial truth, and the data-quality contract. If I had more time, I would add stronger error-code contract tests to ensure 400, 401, and 404 behaviors stay consistent and do not leak backend internals.
