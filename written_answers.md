# Written answers — Hugo Segoviano

> I wrote these answers entirely without AI assistance. The only tool I used was spell-check.

---

## Q1 — Production correctness validation

In a multi-tenant sales application I owned, we had to add production correctness validation to catch data issues before they affected financial reporting. The system processed partner payouts and relied on a reconciliation job that compared source transactions against ledger totals. We added a daily validation gate that checked counts, totals, and a known-good dataset for expected edge cases. This caught a bug where refunds were being double-counted in one of the payout batches after a schema change.

The fix was not just a one-off patch. We added a contract check between the source feed and the ledger, and we created an alert when the delta crossed a threshold. That reduced the risk of silent data corruption and gave us a clear signal before customers saw incorrect balances. The gate worked because it validated the class of problem, not just one specific transaction.

What did not work was the initial alert threshold. We started too aggressively and created noisy alerts for normal variance. We fixed that by calibrating the threshold against historical patterns and by keeping the alert tied to a specific reconciliation stage. If I had more time, I would also add a golden dataset for edge cases such as partial refunds, failed retries, and timezone mismatches.

## Q2 — Scaling-forced structural change

The clearest example was a system that started as a lightweight internal tool and then grew quickly enough to expose architectural limits. We originally built it using a single shared code path with a lot of business rules embedded directly in the app logic. The trigger was not a single spike, but steady growth in requests and data volume combined with more teams depending on the same codebase.

At that point, the problem was not just performance. It was that every new team change created coupling and risk. We moved the business logic into a clearer service boundary, separated read and write paths, and introduced a data access layer so queries and business rules were no longer mixed together. This allowed us to scale the app without one team’s changes breaking another team’s workflow.

There was pushback, especially from people who preferred the speed of the old monolithic structure. The decision rule was simple: if a change required touching the same logic in more than one place or caused fragile cross-team dependencies, it was a sign we needed deeper structure. We made the change because the cost of not doing it was rising faster than the cost of the refactor.

## Q3 — A time I rejected AI output

One concrete example came when we were migrating a voice workflow from one vendor to another. The original system had a prompt that had been tuned through several iterations, and the new vendor looked similar on paper. The AI-generated migration plan looked convincing at first: it kept most of the original prompt structure, changed only a few language fragments, and suggested the new provider would behave the same way.

The signal that changed my mind was not the wording of the output; it was the runtime behavior. The new provider had different constraints around session limits, interaction length, and failure recovery, and the AI output did not account for those differences. It treated the new platform like a drop-in replacement when it was not.

I stopped the rollout and rebuilt the workflow against the real vendor constraints instead of the superficial similarity between the systems. I also changed my review process so I no longer accept AI output that seems polished without validating the actual business behavior. The rule I use now is simple: if an AI suggestion affects a runtime boundary, I verify it against the real contract before I trust it.
