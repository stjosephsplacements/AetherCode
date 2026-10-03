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
