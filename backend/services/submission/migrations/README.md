# Submission migrations

Run these paired migrations with `aether_submission_migrator`:

```sh
make migrate SVC=submission DIR=up
```

`000001` establishes role-bound schemas and signed request contexts. `000002`
creates tenant-scoped attempt data with forced RLS and append-only evidence.
`000003` aligns the original inbox/outbox with the shared leased publisher
contract. `000004` replaces the one-row authorization projection with complete,
revisioned grant snapshots. `000005` materializes Assessment assignment
snapshots and exposes narrow security-definer attempt workflows. `000006`
hardens PL/pgSQL workflow execution, preserves dispatch metadata through
completion, makes late Judge completions idempotent, and enriches the graded
analytics event without changing its schema version. `000007` atomically
cancels nonterminal attempts and pending evaluation work when a newer
Assessment assignment snapshot is revoked.

Apply the database role bootstrap first. Do not edit applied files. Rollback is
intentionally refused while active attempts/evaluations exist or while an old
authorization projection could not faithfully represent current grants.

`000008_authorization_projection_resync` adds the local recovery state and
target-bound outbox request needed when the normal grant durable is older than
stream retention. It keeps Submission RLS denied until its complete batch's
count and SHA-256 manifest are verified by the projection worker.

`000009_attempt_started_outbox` derives one strict analytics-safe
`submission.attempt_started.v1` payload only from the newly appended start
audit event in the same candidate transaction. The application supplies
distinct UUIDv7 audit and outbox IDs; a partial uniqueness index prevents a
second start event for the same tenant/attempt.

`000010_judge_completion_bridge` adds a separate execute-only
`aether_submission_judge_adapter` ingress boundary. It validates a UUIDv7
leased completion against the locally recorded `judge_job_id`, records an
immutable payload fingerprint and delivery history, and writes the
platform-owned `judge.completed.v1` outbox event in the same transaction.
Rollback refuses to discard terminal ingress evidence.

`000020_assignment_item_execution` persists each assignment item's evaluation
key reference, sample bundle, limits and languages from the Assessment
snapshot, and makes `append_answer_revision` refuse a language the item does
not list.

`000021_evaluation_dispatch` adds the claim lease columns to
`evaluation_requests` and two execute-only routines for the Judge adapter role:
`claim_evaluation_requests` (`FOR UPDATE SKIP LOCKED`, doubling lease capped at
five minutes) and `mark_evaluation_dispatched`. Rollback refuses while any
request is still queued.

`000022_weighted_grading` records each test's weight, scores an item by passed
weight over total weight (all or nothing when no units were reported), writes
score summaries with `calculation_version` 2, moves attempt closing into the
internal `finalize_attempt_grading`, and adds `mark_evaluation_failed` so a
permanently failed dispatch still grades the attempt. Rollback refuses once any
non-default weight exists.

`000023_attempt_time_limit` projects the snapshot's `duration_seconds`, makes
`start_attempt` set the deadline to the earlier of start plus duration and the
window's close, accepts answers and submits for `answer_grace()` (15 s) past
the deadline, and makes `expire_overdue_attempts` submit the latest answers
(or expire an attempt with none) once the grace has passed.
`apply_assignment_snapshot` gains a trailing `p_duration_seconds` argument.

`000024_code_run_dispatch` adds dispatch leases, the run verdict and failure
code to `code_runs`, `stdin` and `compile_output` to `code_run_units`, and the
run routines: `start_code_run`, `get_code_run` and `list_code_runs` for the app
role; `claim_code_runs`, `mark_code_run_dispatched`, `mark_code_run_failed`,
`code_run_for_job` and `record_code_run_completion` for the Judge adapter role
(ADR-0021).

`000025_time_up_uuidv7` makes time-up mint its evaluation request and event
ids with `uuidv7()`: Judge refuses a correlation id that is not a UUIDv7, so
000023's version 4 ids failed every time-up request.

`000026_candidate_paper` stores the snapshot's exam title and instructions and
each item's position, title and statement, and adds the owner-bound
`get_attempt_paper_for_candidate` for the app role (ADR-0023).
`apply_assignment_snapshot` gains `p_title` and `p_instructions_markdown`.
Rollback restores the 000023 signature.

`000027_item_submit` adds per-question submits and custom-input runs
(ADR-0025): `evaluation_requests.origin`, `code_runs.kind` and the custom
bundle columns, `evaluation_score`, `submit_item`,
`list_item_submissions_for_candidate` and `start_custom_run`. Grading now
runs only for a `grading` attempt and scores each item's best evaluation
(`calculation_version` 3). `prepare_submission`, `submit_attempt` and
`expire_overdue_attempts` skip revisions already evaluated and grade at once
when nothing new is queued. `claim_code_runs` prefers a run's own bundle.
Rollback restores the 000022 to 000026 functions and drops custom runs.

`000028_exam_operations` adds exam-day operations (ADR-0027): the
`exam_operations` (result release) and `exam_announcements` tables, reachable
only through owner-bound functions; `get_exam_monitor`,
`set_exam_results_release`, `extend_attempt_deadlines` and
`post_exam_announcement` for staff; and `get_attempt_live_state_for_candidate`
and `get_attempt_result_for_candidate` for the candidate.
`attempt_item_scores` factors out the best score per item. Rollback drops them.

`000029_attempt_review` adds `get_attempt_review` (ADR-0029): for staff with
read on `judge_receipts`, an attempt's items with the latest answer's storage
reference, every evaluation with per-verdict counts, the finalized score and
the event log. Rollback drops it.

`000030_exam_latest_answers` adds `list_exam_latest_answers` (ADR-0031): for
staff with read on `judge_receipts`, every attempt's latest saved answer per
question of one exam version, as storage references for the similarity
report. Rollback drops it.

`000031_mcq` adds multiple-choice answers (ADR-0035): projected item kind,
options and key; `choice_answers` and `save_choice_answer`; a trigger that
refuses code for mcq items; the paper's shuffled options and saved
selection; all-or-nothing mcq scores in `attempt_item_scores`; hand-in and
time-up counting selections as answers; and grading whose maximum is every
item the candidate was given (`calculation_version` 4). Rollback refuses while
mcq items exist.

`000032_exam_integrity` adds exam integrity (ADR-0037): `exam_operations`
gains `require_fullscreen` and `block_external_paste`, set by staff with
`set_exam_integrity`; `record_integrity_event` stores a candidate's `blur`,
`paste` or `fullscreen_exit` (at most 1000 per attempt) as
`submission.attempt.integrity.v1`; the live state returns the settings and
the monitor returns them with a flag count per candidate. Rollback drops them.

`000033_result_tests` adds to a released result each item's kind and the
per-test verdicts of its best completed evaluation, by number only
(ADR-0038). Rollback restores the 000028 function.

`000034_regrade` adds regrading (ADR-0039): an answer revision may be
evaluated once per bundle; `regrade_exam_item` evaluates every previously
evaluated answer of an item again on the item's current bundle (origin
`regrade`) and puts graded attempts back to grading; `attempt_item_scores`
counts only evaluations on the current bundle. Rollback refuses while regrade
evaluations exist.

`000035_grading_queue` adds `get_grading_queue` (ADR-0043): for staff with
read on `score_summaries`, the college's graded evaluations and sample runs
waiting for Judge, the oldest wait, and last-hour completions, failures and
median and p95 time to verdict.
