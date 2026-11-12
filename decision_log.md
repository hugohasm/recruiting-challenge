# Decision Log — Hugo Segoviano

> I wrote this decision log entirely without AI assistance. The only tool I used on it was spell-check.

---

## Issues addressed

- **Issue 1 — Merchant isolation and tenant boundary enforcement**
  - What was wrong or weak: The API could return an order belonging to another merchant if the order ID was known. That violated the most basic tenant-boundary rule in a multi-merchant system and created a risk of cross-tenant data exposure.
  - Shape of my improvement: I enforced merchant scoping at the DAL and route layer so that every order read is filtered by the authenticated merchant. Requests for records outside that merchant now return a 404 instead of exposing unrelated data.
  - **Confidence (1–10):** 9
  - **What would falsify this fix** (a specific scenario, input, or behavior that would prove me wrong): A merchant A request can still retrieve an order owned by merchant B even when the request is made through the authenticated merchant A context.
  - **I disagreed with Claude on:** The AI proposed a faster fix that looked cleaner but did not enforce the tenant boundary at the root cause. I rejected that approach because it treated the symptom instead of the actual data-access boundary.
  - Alternatives I considered and rejected: A UI-only restriction or a route-level check without a DAL-level enforcement. I rejected both because they are easier to bypass and weaker as security boundaries.

- **Issue 2 — Net revenue was wrong**
  - What was wrong or weak: Revenue was being calculated as a gross sales total instead of net revenue after refunds. That made the metrics materially inaccurate and could mislead business decisions.
  - Shape of my improvement: I corrected the revenue logic so net revenue is calculated as sales minus refunds and centralized the rule in the DAL so the business logic is consistent across the order and revenue calculations.
  - **Confidence (1–10):** 9
  - **What would falsify this fix:** A refund is counted as additional revenue or the final net figure is still higher than the actual sales after refunds.
  - **I disagreed with Claude on:** The AI preferred to keep the original logic because it was simpler and less invasive. I pushed back because the business rule mattered more than visual simplicity.
  - Alternatives I considered and rejected: Keep the gross total and hide the issue behind a label change. I rejected that because it would preserve the wrong numbers rather than fix the problem.

- **Issue 3 — Weak validation on order creation**
  - What was wrong or weak: The app accepted invalid order payloads without checking the full contract. This allowed bad emails, invalid amounts, unsupported status values, and incorrect order types to reach the database.
  - Shape of my improvement: I added validation before persisting a new order. Invalid payloads are rejected early if the email is invalid, the amount is not positive, the type is unsupported, or the status does not match the allowed business values.
  - **Confidence (1–10):** 8
  - **What would falsify this fix:** An invalid payload still gets stored, or a negative amount / unsupported status reaches the database.
  - **I disagreed with Claude on:** The AI wanted to keep validation broad and generic instead of matching the actual business contract. I pushed back and insisted on validating the real domain rules rather than a generic catch-all.
  - Alternatives I considered and rejected: Silent error handling or generic validation responses. I rejected those because they hide data quality problems instead of stopping them at the boundary.

## Feature chosen

- **Feature:** Order search with filters
- **Why this one and not the others:** It adds the most practical value to the merchant dashboard. It helps merchants answer real operational questions without leaving the system, and it is a natural extension of the dashboard’s decision-making workflow.
- **What I cut to ship it in budget:** I did not do a full visual redesign, I did not broaden the refactor, and I did not add additional product features beyond the one selected.
- **Confidence (1–10) that the shape I picked is the right one:** 8
- **What would change my mind:** If the search API proved unstable under growth, required poor tradeoffs in sorting and pagination, or made the dashboard harder to reason about than the value it provided.

## Things I noticed but did NOT fix

- The current authentication model is still demo-only and relies on a trusted header rather than a real identity system.
- Some business invariants could be enforced deeper in the data layer with stricter database constraints.
- The app still assumes a simplified merchant trust model rather than a full production auth boundary.

## Docs / code I left alone deliberately

- I did not do a wide UI redesign.
- I did not add more than one feature.
- I did not expand the scope into a broader production auth redesign.

## What I'd do with another 6 hours

- Add stronger API contract tests around error codes and response consistency.
- Strengthen validation with more explicit test coverage for edge cases.
- Explore a real auth model if this were a production system instead of a challenge app.

## Where I felt uncertain

- The biggest uncertainty is the authentication model. The merchant isolation fix is strong, but it is not the same as real identity enforcement.
- I am also not fully confident that the data-layer invariants are sufficient for a larger production dataset.
- I would want more contract-level testing before calling the API fully production-ready.
