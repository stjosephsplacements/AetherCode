# ADR-0025: Per-question submit, best score and custom input

- Status: accepted
- Date: 2026-10-19

## Context

The platform's exam screen had **Run** (sample tests) and one button that
ended the whole exam. Students expect what HackerRank and the exam app
(`apps/exam-v1`) offer:

- **Submit** on each question, judged on all tests, hidden ones included;
- **Test against custom input**;
- a separate **End test**.

The exam app counts each question's best submit. Submission graded only
once, on the whole attempt: `finalize_attempt_grading` summed every
evaluation request and ran whenever an attempt had none open.

## Decision

**Submit is a permanent evaluation of the question's latest saved code.**
`POST /v1/tenants/{t}/attempts/{a}/items/{i}/submissions` calls
`submission.submit_item`. While the attempt is active and before the deadline
plus grace, it records an evaluation request (`origin = item_submit`) for the
item's latest answer revision, on the item's full bundle. It also announces
the request with `submission.evaluation_requested.v1`.

- The same revision is evaluated once (`UNIQUE (tenant_id, answer_revision_id)`).
  Submitting unchanged code returns the existing evaluation.
- At most two evaluation requests may be open per attempt, and Submit shares
  the per-candidate run rate limit.
- Dispatch, Judge and completion are unchanged: it is an ordinary evaluation
  request.

**Each question scores its best evaluation**, whether a submit or the final
hand-in. `submission.evaluation_score` computes one evaluation's weighted
score. `finalize_attempt_grading` takes the maximum per item and sums those,
and score summaries are written with `calculation_version` 3. This is the
exam app's rule, chosen so that breaking working code later cannot lose
marks.

**Grading runs only for a handed-in attempt.** `finalize_attempt_grading`
returns early unless the attempt is `grading`, so a submit completing
mid-exam never ends the attempt.

**End test and time-up evaluate only code not yet submitted.**
`prepare_submission`, `submit_attempt` and `expire_overdue_attempts` skip
latest revisions that already have an evaluation request. When nothing new is
queued, they grade the attempt at once, since no completion will arrive to do
it. Time-up with no answers at all still marks the attempt `expired`.

**Candidates see hidden tests as counts only.**
`GET .../items/{i}/submissions` returns each evaluation's state, score,
passed and total test counts, and counts per verdict. It never says which
test failed or how long it ran: that would describe a hidden test to a
candidate still being graded on it. This deliberately shows less than
HackerRank, which marks each hidden test passed or failed.

**Custom input is a run with its own bundle.** A run request may carry
`input`. Submission builds a one-test sample bundle from it
(`evalbundle.BuildSample`), encrypts it with the platform key, and stores it
beside the run's source. `submission.start_custom_run` records the run with
`kind = custom` and the bundle reference. `claim_code_runs` hands Judge that
bundle instead of the item's samples, and Judge returns the output because the
bundle is marked sample. Custom runs stay ephemeral like other runs and earn
nothing.

**Analytics counts a question once.** Its per-question rollup takes the best
evaluation of each question instead of summing them (analytics migration
000015).

## Consequences

- Judge load grows with submits: each one runs every test of the question.
  Two open requests per attempt and the shared rate limit bound it.
- Score summaries from before this change keep `calculation_version` 2.
  Regrading an old attempt would apply the best-evaluation rule, which gives
  the same result when each item has one evaluation.
- The candidate web UI adds a question rail, Submit code, custom input,
  End test with a per-question summary, editor settings and time warnings.
