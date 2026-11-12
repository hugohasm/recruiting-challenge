# Sign-off — Hugo Segoviano

> **I wrote this sign-off entirely without AI assistance.**

## Authorship declaration

> I wrote this validation design entirely without AI assistance. The only tool I used was spell-check.

---

## Sign-offs

- ✅ **`7a83067` — `fix: enforce merchant scoping on order reads`** — I have read this. I checked the merchant-scoping changes in the order read path, specifically the tenant filter and the handling of missing or foreign records, because exposing another merchant’s orders directly affects data security and business trust.

- ✅ **`f2467a8` — `fix: calculate net revenue and validate order payloads`** — I have read this. I checked the net revenue logic and the request-validation rules because they directly affect financial correctness and data integrity.

- ⚠️ **`d8602ae` — `test: add regression checks for tenant leakage and revenue math`** — I have read most of this. I accepted the regression test changes without reviewing every assertion in detail because I considered them useful guardrails for the business fixes, but not the main decision point of the patch. Risks I accept: gaps in coverage or incorrect assumptions in parts of the test suite I did not inspect. I would want to complete that review before staking my name on production.

- ✅ **`c426d7f` — `docs: document API contract and expected errors`** — I have read this. I checked the headers, query parameters, responses, and expected error behavior because unclear API contracts create integration mistakes and operational confusion.

- ❌ **`32603e0` — `feat: add order filtering for merchant dashboard`** — I have NOT fully read this implementation. I accepted the feature because I considered it a secondary change relative to the core data-integrity fixes. Risks I accept: defects in filter logic, pagination behavior, or merchant-boundary enforcement that I did not personally verify. I would want to review the implementation before staking my name on production.

---

## What this artifact measures

I distinguish the changes I reviewed in detail from the regression tests I reviewed only in part and the feature I accepted without a full implementation review. These entries record the work I actually checked, the assumptions I accepted, and the risks I took on; they do not claim validation at 1.5k RPS.
