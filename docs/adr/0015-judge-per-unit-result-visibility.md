# ADR-0015: Carry per-unit Judge results on the completion ingress, not the platform event

- Status: accepted
- Date: 2026-08-25

## Context

The Judge wrapper reports one normalized verdict, and optional timing, for every
executed test case of a graded submission. Submission needs that breakdown for
two different audiences: a candidate may see how many hidden tests passed, while
a reviewer may see which specific test failed. Raw stdout, stderr, and expected
output never leave the wrapper in either case.

Submission's formal-grading completion path has four hops, and only the last one
writes the durable receipt:

1. `judgecompletion.Worker` pulls completions over private mTLS gRPC.
2. `judgecompletion.Store.Persist` calls `submission.ingest_judge_completion`,
   which writes `submission.judge_completion_ingress` and one
   `judge.completed.v1` row in `app.outbox_events`. It does not write
   `submission.judge_receipts`.
3. The outbox relay publishes `judge.completed.v1` to NATS.
4. Submission's own durable consumer (`submission_judge_completed_v1`) calls
   `projection.Store.ApplyJudgeCompletion`, which calls
   `submission.record_judge_completion`. That routine writes the receipt,
   closes the evaluation request, finalizes the score, and emits
   `submission.attempt_graded.v1`.

The breakdown therefore has to travel from hop 2 to hop 4. Two designs were
considered.

**A. Carry it in the `judge.completed.v1` payload.** The event stays
self-describing and the projection needs no other source. But that payload is a
broadcast subject with a second subscriber (Analytics) that neither needs nor
should receive reviewer-grade detail, and it is fingerprinted:
`judge_completion_ingress.payload_sha256` is recomputed and compared on every
replayed delivery, so changing the payload shape changes the fingerprint of
completions that were already ingested.

**B. Carry it on the ingress row.** The ingress row and the outbox event are
written in one transaction and share `judge_event_id`, which is also carried in
the event payload and is the ingress primary key, so `record_judge_completion`
can always correlate the two. The bus payload is untouched.

## Decision

Take B. `submission.ingest_judge_completion` gains a `p_unit_results jsonb`
parameter, validates it, stores it on
`submission.judge_completion_ingress.unit_results`, and includes it in the
existing replayed-payload equality check.
`submission.record_judge_completion` expands that array into
`submission.judge_receipt_units` in the same transaction as the receipt insert,
before the cancelled-request early return, so cancelled and graded attempts keep
the same evidence. The `judge.completed.v1` payload is byte-identical to before.

Visibility is enforced by the signed capability's resource, not by a role check
in Go. The two views are separate `SECURITY DEFINER` routines:

- `submission.get_attempt_unit_summary_for_candidate` requires a capability for
  `submission.attempts`, binds the attempt to
  `authz.current_context_actor_id()`, and returns only `passed_units` and
  `total_units` per exam item.
- `submission.list_attempt_unit_results` requires a capability for
  `submission.judge_receipts` and returns the full breakdown.

`judge_receipts` is already a protected Submission resource in the canonical
authorization contract, and a `self`-scoped assignment — the only kind a
candidate holds — cannot name it. A candidate is therefore refused twice: by
central policy before Submission is reached, and by the database routine if a
handler is ever wired to the wrong resource.

## Consequences

Analytics, the other `judge.completed.v1` subscriber, is unaffected: its
payload contract does not change. The bus does not carry reviewer-grade detail,
and `judge_completion_ingress.payload_sha256` keeps its existing value for every
completion ingested before this change.

`ingest_judge_completion` changes signature, so migration `000018` drops the
fourteen-argument form rather than leaving an overload that would silently
discard the breakdown, and its rollback recreates that form in full because
`000010`'s own rollback revokes it by name.

The event is no longer fully self-describing: a `judge.completed.v1` replayed
against a database with no matching ingress row would produce a receipt with no
units. Ingress rows are never deleted (`ON DELETE RESTRICT` throughout, and
`000010`'s rollback refuses while any exist), so this is reachable only by
hand-crafting an event that the ingress never produced.

A replayed delivery whose breakdown differs from the stored one now raises
`23505` alongside the existing payload-fingerprint mismatch, rather than
silently keeping the first. This is the intended fail-closed behaviour, and it
means a completion ingested by a build that predates this change, then
redelivered after it with a non-empty breakdown, is rejected. The window is one
unacknowledged lease across the upgrade.
