# ADR-0039: Regrade with a corrected question version

- Status: accepted
- Date: 2026-10-20

## Context

A wrong expected output in a hidden test fails every correct answer. The exam
app lets faculty fix the test and regrade every submission of the question.
On the platform a published exam is immutable and pins each item's bundles;
a question fix is a new published question version.

## Decision

**Assessment repins the item** (migration `000031`).
`POST /v1/tenants/{t}/exam-versions/{v}/items/{i}/repin` with a published
version of the item's own coding question replaces the item's bundles,
limits and statement; its marks, section and question stay. The
published-exam immutability trigger lets exactly this update through, by a
transaction-local setting only `repin_exam_item` sets. Every assignment of
the exam version gets a new version and is snapshotted again; the builder
now sends started, completed and expired assignments as active (Submission
knows only active and revoked), so Submission's item projections carry the
new bundle.

**Submission regrades** (migration `000034`).
`POST /v1/tenants/{t}/exam-versions/{v}/items/{i}/regrade` (staff, write on
`score_summaries`) creates, for every answer revision of the item that was
evaluated before, a `regrade` evaluation on the item's current bundle, and
puts graded attempts back to grading; they are graded again when the new
evaluations finish. A revision may now be evaluated once per bundle, and an
item scores only evaluations on its current bundle. Regrade is idempotent:
it skips revisions already evaluated on the current bundle.

The staff exam page offers the newer published versions of each item's
question and runs both steps.

## Consequences

- Repinning during a running exam is allowed, but a student who hands in
  afterwards may have answers evaluated only on the old tests; run the
  regrade again after the exam (it then catches them).
- Regraded scores reach staff results through the usual graded event.
- Students who had their results released see the new score on reload.
