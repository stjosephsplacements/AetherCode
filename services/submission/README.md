# Submission

Submission owns the durable candidate-attempt record: attempt state, append-only answer revisions, immutable evaluation requests, Judge receipts, and final score summaries. It does not call Judge0 and it never stores source code, hidden tests, SEB material, or large output in PostgreSQL. Those payloads are encrypted object-storage references with SHA-256 checksums.

Candidate API:

- `POST /v1/tenants/{tenant_id}/attempts` starts an assignment-backed attempt. `Idempotency-Key` is required; a newly created attempt emits one durable analytics-safe start fact, while an idempotent replay emits none.
- `GET /v1/tenants/{tenant_id}/attempts/{attempt_id}` returns the caller's own attempt.
- `PUT /v1/tenants/{tenant_id}/attempts/{attempt_id}/answers/{exam_item_id}` appends an answer revision with optimistic attempt-version checking.
- `POST /v1/tenants/{tenant_id}/attempts/{attempt_id}/submit` atomically snapshots the latest answer per item, creates durable evaluation requests, and emits one `submission.evaluation_requested.v1` outbox event per request. `Idempotency-Key` is required.

Every route obtains a fresh central User authorization decision, then consumes the signed capability in one local transaction. Database functions enforce candidate ownership again; a candidate cannot select another candidate's attempt even if an application handler is changed incorrectly. Local authorization grant snapshots are revision-bound and fail closed while they lag a revocation.

## Event contracts

The service consumes these versioned platform events through durable JetStream consumers and transactional inboxes:

`assessment.candidate_assignment.snapshot.v1`

```json
{
  "tenant_id": "uuid",
  "candidate_assignment_id": "uuid",
  "candidate_id": "uuid",
  "exam_id": "uuid",
  "exam_version_id": "uuid",
  "available_from": "RFC3339 timestamp",
  "available_until": "RFC3339 timestamp",
  "attempt_limit": 1,
  "lifecycle_state": "active",
  "version": 1,
  "items": [{
    "exam_item_id": "uuid",
    "evaluation_bundle_object_key": "encrypted object key",
    "evaluation_bundle_checksum": "lowercase SHA-256",
    "maximum_score": 10
  }]
}
```

`judge.completed.v1` is emitted by the platform-side Judge adapter after it has durably pulled and acknowledged the private Judge-wrapper completion. Its payload contains `tenant_id`, `evaluation_request_id`, `judge_job_id`, `judge_event_id`, `verdict`, canonical `completed_at`, optional non-negative execution metrics, and an all-or-nothing encrypted result reference (`result_object_key`, `result_checksum`, `encryption_key_reference`). Submission records the receipt once and finalizes an attempt only after every evaluation request is terminal.

A strictly newer `assessment.candidate_assignment.snapshot.v1` with
`lifecycle_state: "revoked"` is an immediate terminal boundary. In its inbox
transaction Submission marks all matching `created`, `active`, `submitted`,
or `grading` attempts `cancelled`; marks their queued or dispatched evaluation
requests `cancelled` with `assessment_assignment_revoked`; and writes one
`submission.attempt_cancelled.v1` outbox event per affected attempt. Terminal
attempts are preserved. A late `judge.completed.v1` is acknowledged without
changing the cancelled attempt or producing a score.

Submission emits `submission.evaluation_requested.v1` to the platform stream.
It is the contract for a separately approved admission adapter, not the Judge
wrapper or Judge0. It contains the evaluation request ID, opaque answer
revision ID, immutable evaluation bundle reference/checksum, maximum score, and
a unique caller idempotency key. The delivered completion bridge deliberately
does not call `SubmitExecution`; until the approved admission and dispatcher
phases exist, no service sends new execution requests from this event.

When `start_attempt` inserts a new attempt, Submission emits exactly one
`submission.attempt_started.v1` outbox event (schema version `1`). It never
emits that event for an idempotency replay. The payload is strictly limited to
`tenant_id`, `attempt_id`, `candidate_assignment_id`, `candidate_id`,
`exam_id`, `exam_version_id`, and `started_at`; it contains no source,
object-storage, test, SEB, or Judge material. The append-only attempt audit
event and broker outbox event use distinct application-generated UUIDv7 IDs.

When the final Judge completion is durably reconciled, Submission emits
`submission.attempt_graded.v1` (schema version `1`). Its payload is safe for
event-fed analytics and contains `attempt_id`, `tenant_id`,
`candidate_assignment_id`, `candidate_id`, `exam_id`, `exam_version_id`,
`attempt_number`, `lifecycle_state` (`graded`), `score`, `maximum_score`, and
`completed_at`. The event contains no source code, test input, Judge payload,
or encrypted-object key material.

`submission.attempt_cancelled.v1` (schema version `1`) contains the same
attempt, tenant, candidate, exam, and assignment identity fields as the
graded event, plus `lifecycle_state` (`cancelled`),
`cancellation_reason` (`assessment_assignment_revoked`),
`assessment_snapshot_event_id`, and `cancelled_at`.

## Runtime configuration

Required in all environments:

- `SUBMISSION_DATABASE_URL` — `aether_submission_app` credentials.
- `AUTHZ_GRPC_TARGET` and the central-authentication TLS settings required by `libs/pkg/authz`.

When `NATS_URL` is set (required in staging and production):

- `SUBMISSION_PROJECTION_DATABASE_URL` — `aether_submission_projection_worker` credentials.
- `NATS_URL` — the platform JetStream endpoint.

When `JUDGE_COMPLETION_ENABLED=true` (mandatory in staging and production):

- `SUBMISSION_JUDGE_ADAPTER_DATABASE_URL` — dedicated
  `aether_submission_judge_adapter` credentials; this role has only execute
  access to the completion-ingestion function.
- `JUDGE_COMPLETION_GRPC_ADDR`, `JUDGE_COMPLETION_TLS_CERT_FILE`,
  `JUDGE_COMPLETION_TLS_KEY_FILE`, and `JUDGE_COMPLETION_TLS_CA_FILE` — private
  wrapper endpoint and mTLS material.
- `JUDGE_COMPLETION_CONSUMER_ID`, `JUDGE_COMPLETION_BATCH_SIZE`,
  `JUDGE_COMPLETION_LEASE_SECONDS`, `JUDGE_COMPLETION_POLL_INTERVAL`, and
  `JUDGE_COMPLETION_RPC_TIMEOUT` — bounded bridge controls. The worker is not
  ready until it has completed a recent pull/persist/ACK cycle.

The application pool must not use the migration owner or a role with `BYPASSRLS`. The projection worker is separate because it can write only private inbox/projection state and invoke narrow security-definer projection functions.

## Database lifecycle

`000003` aligns the legacy bootstrap outbox/inbox with the shared leased outbox contract. `000004` upgrades authorization state to full revisioned grant snapshots. `000005` adds assignment projections and the attempt workflow routines. `000006` hardens workflow function compilation and terminal Judge reconciliation while retaining backward-compatible event schema version `1`. `000007` turns a newer revoked Assessment snapshot into atomic attempt/evaluation cancellation. `000009` derives one analytics-safe start outbox fact from a newly appended attempt audit event, with a database uniqueness backstop against duplicate publication. `000010` adds the dedicated completion ingress, verifies a local dispatched-job correlation, and emits `judge.completed.v1` in the same idempotent transaction before the remote lease is acknowledged. Apply paired migrations with the dedicated migrator:

```sh
make migrate SVC=submission DIR=up
```

Do not edit an applied migration. Rollbacks deliberately refuse to discard active attempts, queued evaluations, or grant scopes that the old projection cannot represent.

Attempt and answer evidence defaults to seven-year retention, with legal-hold flags retained on the durable records. The separate Judge wrapper owns its shorter execution-record retention; this service stores only the durable completion receipt and referenced result metadata.

## Authorization projection recovery

`000008_authorization_projection_resync` makes the existing complete grant
projection unavailable at startup and after a consumer/publisher failure until
a User-issued targeted batch verifies by count and SHA-256 manifest. The
dedicated `aether_submission_projection_worker` writes the request through
Submission's outbox and consumes only Submission's response subjects.
`SUBMISSION_PROJECTION_DATABASE_URL` must use that role; no request-serving
credential can access the resync state.
