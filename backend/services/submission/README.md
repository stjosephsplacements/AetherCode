# Submission

Submission owns the durable candidate-attempt record: attempt state, append-only answer revisions, immutable evaluation requests, Judge receipts, and final score summaries. It admits graded work to the private Judge wrapper over mTLS (it never calls Judge0 itself) and it never stores source code, hidden tests, SEB material, or large output in PostgreSQL. Those payloads are encrypted object-storage references with SHA-256 checksums.

Candidate API:

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/tenants/{tenant_id}/attempts` | Start an assignment-backed attempt. `Idempotency-Key` is required; a newly created attempt emits one durable analytics-safe start fact, while an idempotent replay emits none. |
| `GET` | `/v1/tenants/{tenant_id}/attempts` | List the calling candidate's attempts. Keyset paged via `limit` (1-100, default 20) and `cursor`. Filters: `exam_version_id`, `lifecycle_state`. Rows are bound to the signed context actor by `submission.list_attempts`. |
| `GET` | `/v1/tenants/{tenant_id}/attempts/{attempt_id}` | Return the caller's own attempt. |
| `PUT` | `/v1/tenants/{tenant_id}/attempts/{attempt_id}/answers/{exam_item_id}` | Append an answer revision with optimistic attempt-version checking. The body is `{language, source, expected_attempt_version}`: raw source of at most 64 KiB (the limit of the exam app this replaces) in one of the item's supported languages. The service encrypts it with KMS, stores the ciphertext in object storage under a key it generates, and records the object key, the SHA-256 of the ciphertext and the key reference. A client can never supply those references. A language the item does not list is a `400`; unconfigured storage or KMS is a `503`. |
| `POST` | `/v1/tenants/{tenant_id}/attempts/{attempt_id}/submit` | Atomically snapshot the latest answer per item, create durable evaluation requests, and emit one `submission.evaluation_requested.v1` outbox event per request. `Idempotency-Key` is required. |
| `GET` | `/v1/tenants/{tenant_id}/attempts/{attempt_id}/answers` | List answer-revision metadata for an attempt the caller owns. Filters: `exam_item_id`. |
| `GET` | `/v1/tenants/{tenant_id}/attempts/{attempt_id}/unit-results` | Return the redacted hidden-test outcome for an attempt the caller owns: `passed_units` and `total_units` per exam item, and nothing more. |
| `POST` | `/v1/tenants/{tenant_id}/attempts/{attempt_id}/items/{exam_item_id}/runs` | Run `{language, source}` against the item's sample tests; `202` with the queued run. See "Runs". |
| `GET` | `/v1/tenants/{tenant_id}/attempts/{attempt_id}/items/{exam_item_id}/runs` | List the caller's runs of one item, newest first, with passed/total unit counts. Keyset paged via `limit` and `cursor`. |
| `GET` | `/v1/tenants/{tenant_id}/attempts/{attempt_id}/runs/{run_id}` | Return one run with every sample test's input, expected output, output, stderr and compile output. |

Reviewer API:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/tenants/{tenant_id}/attempts/{attempt_id}/judge-receipts` | Return every Judge receipt for one attempt with its full per-unit breakdown: each executed test case's `unit_number`, normalized verdict, and optional timing. Authorized against the `judge_receipts` resource, which the canonical policy grants only to college-, department-, batch-, or platform-scoped roles; a candidate's self-scoped assignment cannot name it. |

The two views are not two renderings of one response. They are separate database routines requiring capabilities signed for different resources (`submission.attempts` and `submission.judge_receipts`), so a handler mistake cannot widen the candidate view into the reviewer one. See `docs/adr/0015-judge-per-unit-result-visibility.md`.

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
  "duration_seconds": 3600,
  "lifecycle_state": "active",
  "version": 1,
  "items": [{
    "exam_item_id": "uuid",
    "evaluation_bundle_object_key": "encrypted object key",
    "evaluation_bundle_checksum": "lowercase SHA-256",
    "maximum_score": 10,
    "evaluation_bundle_key_reference": "KMS key reference, null on legacy items",
    "sample_bundle_object_key": "null on legacy items",
    "sample_bundle_checksum": "null on legacy items",
    "sample_bundle_key_reference": "null on legacy items",
    "time_limit_ms": 2000,
    "memory_limit_kib": 262144,
    "supported_languages": ["c", "python3"]
  }]
}
```

`duration_seconds` (60-43200, absent on snapshots published before Assessment
migration `000025`) sets each candidate's deadline; see "Attempt expiry
worker". Every item field after `maximum_score` is persisted per assignment
item (migration `000020`). The last three are null on items pinned before Assessment migration `000024`; such an item accepts no answer and its evaluation requests are failed rather than dispatched.

### Languages

The candidate-facing language name is Judge's language key, and the Question Bank's `supported_languages` use the same vocabulary: `c`, `cpp17`, `java`, `python3`, `javascript`, `go`. There is no translation layer, so there is one source of truth (Judge's language table). `append_answer_revision` checks the candidate's `language` against the item's pinned `supported_languages`; Judge enforces the second half (a language it has not enabled is retried, not failed).

`judge.completed.v1` is emitted by the platform-side Judge adapter after it has durably pulled and acknowledged the private Judge-wrapper completion. Its payload contains `tenant_id`, `evaluation_request_id`, `judge_job_id`, `judge_event_id`, `verdict`, canonical `completed_at`, optional non-negative execution metrics, and an all-or-nothing encrypted result reference (`result_object_key`, `result_checksum`, `encryption_key_reference`). Submission records the receipt once and finalizes an attempt only after every evaluation request is terminal.

The wrapper also reports one normalized verdict per executed test case. That
breakdown is recorded on `submission.judge_completion_ingress.unit_results` and
materialized into `submission.judge_receipt_units` by the same transaction that
writes the receipt. It is deliberately absent from the `judge.completed.v1`
payload: the event is a broadcast subject, and a per-unit verdict is
reviewer-grade evidence rather than something every subscriber needs.

A strictly newer `assessment.candidate_assignment.snapshot.v1` with
`lifecycle_state: "revoked"` is an immediate terminal boundary. In its inbox
transaction Submission marks all matching `created`, `active`, `submitted`,
or `grading` attempts `cancelled`; marks their queued or dispatched evaluation
requests `cancelled` with `assessment_assignment_revoked`; and writes one
`submission.attempt_cancelled.v1` outbox event per affected attempt. Terminal
attempts are preserved. A late `judge.completed.v1` is acknowledged without
changing the cancelled attempt or producing a score.

Submission emits `submission.evaluation_requested.v1` to the platform stream
for observers (analytics decodes it strictly, so its payload is unchanged). It
contains the evaluation request ID, opaque answer revision ID, immutable
evaluation bundle reference/checksum, maximum score, and a unique caller
idempotency key. It is not what triggers grading: the dispatcher below works
from the `evaluation_requests` table directly.

## Dispatching to Judge

`internal/adapters/judgedispatch` is the worker that sends queued evaluation
requests to Judge `SubmitExecution`. The completion bridge (`judgecompletion`)
stays receive-only; the dispatcher has its own narrow client on a separate mTLS
connection to the same endpoint, using the same certificates
(`JUDGE_COMPLETION_*`) and the same execute-only database role
(`aether_submission_judge_adapter`).

- **Claim.** `submission.claim_evaluation_requests(limit, lease_seconds)` takes
  queued rows `FOR UPDATE SKIP LOCKED`, so replicas get disjoint rows. A claim
  is a lease: it bumps `dispatch_attempts` and sets `dispatch_after` to
  `lease_seconds * 2^attempts` (capped at five minutes). It returns the bundle
  reference, checksum and key reference, the source object reference, checksum
  and key reference, the language, and the limits from the assignment item
  projection. Items projected without a key reference or limits come back with
  NULLs so they can be failed instead of waiting forever.
- **Submit.** One request per claim: the idempotency key and correlation id are
  the evaluation request id, tenant fairness key is the tenant, and `expires_at`
  is `queued_at + 12h`, derived so a replay is byte-identical and Judge
  returns the job it already accepted. CPU limit is the question's time limit
  clamped to Judge's 60 s maximum; wall time is three times that, capped at
  120 s; memory is the question's limit clamped to 2 GiB; processes are 64.
  `request_ciphertext_ref` is left empty.
- **Record.** `submission.mark_evaluation_dispatched` stores `judge_job_id`
  and moves the row to `dispatched` (satisfying the `dispatched_at` CHECK). A
  request cancelled while in flight still gets its job id, because the
  completion ingress refuses a completion whose job is not recorded locally.
- **Retry.** A transient failure (unavailable, rate limited, language not yet
  enabled, internal, or a failed mark) records nothing: the row simply becomes
  claimable again when its lease lapses, with the longer lease. There is no
  retry cap; an outage delays grading and then resumes it.
- **Permanent failure.** Judge answering `InvalidArgument` or `AlreadyExists`,
  or an item with no key reference or limits, calls
  `submission.mark_evaluation_failed` with `judge_rejected` or
  `item_not_executable`. The request scores zero, and failing the last open
  request of an attempt grades the attempt (the shared
  `finalize_attempt_grading`), so a candidate is never left waiting.

## Runs

A candidate runs code against an exam item's sample tests, as in the exam app
(ADR-0021). A run is authorized like saving an answer (a write to the caller's
own attempts) and accepted while the attempt is `active`, up to the deadline
plus `answer_grace()`. The service encrypts and stores the source exactly as it
does an answer, under `candidate-source/<tenant>/<attempt>/runs/<run id>`, and
`submission.start_code_run` records a queued `code_run`. It refuses with `409`
and a candidate-facing message (SQL `DETAIL 'candidate: …'`) when the item has
no sample tests, the exam has ended, or two of the attempt's runs are still in
flight. Runs are also limited per candidate in memory
(`SUBMISSION_RUN_CODE_RATE`, default 300 an hour, burst 30); a refusal is
`429` with `Retry-After: 12`.

The dispatcher claims queued runs with `submission.claim_code_runs` next to
evaluation requests (the same leases) and submits each with the item's
**sample** bundle; the run id is the idempotency key and correlation id, and
`expires_at` is the run's creation plus one hour. Judge returns each sample
test's output only for a sample bundle, as encrypted objects. The completion
bridge asks `submission.code_run_for_job` whether a completion belongs to a
run; if so it fetches each unit's output, checks it against Judge's SHA-256,
decrypts it with the platform key, and records the units with
`submission.record_code_run_completion`. Otherwise the completion takes the
grading path below. A run never writes evaluation requests, Judge receipts or
score summaries, and its output is shown unredacted because sample tests are
not confidential. The completion bridge therefore needs
`SUBMISSION_STORAGE_*` and `SUBMISSION_KMS_LOCAL_KEY` as well.

## Scoring

An exam item earns `maximum_score x (weight of passed tests) / (weight of all
tests)`, where each unit's weight (1-100) comes from Judge's `UnitResult`. The
weight is stored in `judge_completion_ingress.unit_results` and
`judge_receipt_units.weight`. Units reported without a weight count as 1. A
receipt with no unit breakdown (a compile error reaches no test case) keeps the
all-or-nothing rule: the full maximum for `accepted`, otherwise zero. Score
summaries are written with `calculation_version` 2.

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
- `AUTHZ_GRPC_TARGET` and the central-authentication TLS settings required by `backend/libs/pkg/authz`.

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

When `JUDGE_DISPATCH_ENABLED=true` (mandatory in staging and production; it
requires `JUDGE_COMPLETION_ENABLED=true`, whose endpoint, certificates and
adapter database role it shares):

| Variable | Default | Range | Description |
|---|---|---|---|
| `JUDGE_DISPATCH_ENABLED` | `false` (dev), `true` (staging/production) | bool | Run the dispatcher. |
| `JUDGE_DISPATCH_BATCH_SIZE` | 20 | 1-100 | Evaluation requests claimed per cycle. |
| `JUDGE_DISPATCH_LEASE_SECONDS` | 30 | 5-300 | Base claim lease; doubles per attempt, capped at 300 s. |
| `JUDGE_DISPATCH_POLL_INTERVAL` | 1s | 250ms-1m | Interval between claim cycles. |

The dispatcher is included in the readiness probe: the service is not ready
until a claim cycle has completed recently.

The application pool must not use the migration owner or a role with `BYPASSRLS`. The projection worker is separate because it can write only private inbox/projection state and invoke narrow security-definer projection functions.

Object storage and KMS follow the same MinIO/local-KMS pattern as Question Bank (`backend/libs/pkg/storage/minio`, `backend/libs/pkg/kms/local`). Saving an answer encrypts and stores the candidate's source with them, so it returns `503` until both are configured, and the bucket and KMS key must be the ones Judge reads and decrypts with.

- `SUBMISSION_STORAGE_ENDPOINT`, `SUBMISSION_STORAGE_ACCESS_KEY`, `SUBMISSION_STORAGE_SECRET_KEY`, `SUBMISSION_STORAGE_BUCKET`, `SUBMISSION_STORAGE_USE_SSL`, `SUBMISSION_STORAGE_REGION` — enable object storage when `SUBMISSION_STORAGE_ENDPOINT` is set.
- `SUBMISSION_KMS_LOCAL_KEY` — a base64-encoded 32-byte AES-256-GCM key; enables local KMS when set. Use a managed KMS in production.

## Rate limiting

`POST /v1/tenants/{tenant_id}/attempts` is protected by an in-process,
per-candidate token bucket (`backend/libs/pkg/ratelimit`), keyed on the bearer
assertion's candidate subject rather than tenant ID or client IP, so one
candidate cannot exhaust another tenant-mate's attempt-creation budget. A
rate-limited request receives `429 Too Many Requests` with a
`Retry-After: 3600` header.

| Variable | Default | Description |
|---|---|---|
| `SUBMISSION_START_ATTEMPT_BURST` | 10 | Token-bucket burst capacity. |
| `SUBMISSION_START_ATTEMPT_RATE` | 30 | Refill rate, requests per hour. |

A second, separate per-candidate token bucket is provisioned for the
candidate run-code workflow (`runCodeLimiter` in the HTTP adapter) and will
guard the run-code endpoint once it is wired. Its defaults are deliberately
far more generous than attempt creation's: running code against sample tests
is an iterative debugging action a candidate may reasonably repeat 10+ times
while working a single item, so the limiter exists only to bound abuse, not
to add per-hour friction to normal use. A rate-limited request will receive
`429 Too Many Requests` with a `Retry-After: 60` header — a much shorter
window than attempt creation's, matching the fast iterative nature of the
workflow.

| Variable | Default | Description |
|---|---|---|
| `SUBMISSION_RUN_CODE_BURST` | 30 | Token-bucket burst capacity. |
| `SUBMISSION_RUN_CODE_RATE` | 300 | Refill rate, requests per hour (5/minute sustained). |

## Database lifecycle

`000003` aligns the legacy bootstrap outbox/inbox with the shared leased outbox contract. `000004` upgrades authorization state to full revisioned grant snapshots. `000005` adds assignment projections and the attempt workflow routines. `000006` hardens workflow function compilation and terminal Judge reconciliation while retaining backward-compatible event schema version `1`. `000007` turns a newer revoked Assessment snapshot into atomic attempt/evaluation cancellation. `000009` derives one analytics-safe start outbox fact from a newly appended attempt audit event, with a database uniqueness backstop against duplicate publication. `000010` adds the dedicated completion ingress, verifies a local dispatched-job correlation, and emits `judge.completed.v1` in the same idempotent transaction before the remote lease is acknowledged. `000018` threads the wrapper's per-unit breakdown through that ingress into `submission.judge_receipt_units`, and adds the redacted candidate and full reviewer read routines over it. `000020` persists each assignment item's key reference, sample bundle, limits and languages and makes `append_answer_revision` reject a language the item does not list. `000021` adds the dispatch lease columns and the claim and mark-dispatched routines. `000022` adds test weights, moves attempt closing into `finalize_attempt_grading`, scores by weight, and adds `mark_evaluation_failed`. Apply paired migrations with the dedicated migrator:

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

## Attempt expiry worker

An attempt's `submission_deadline` is the earlier of its start plus the exam's
`duration_seconds` and the assignment window's close (migration `000023`).
Assignments projected from a snapshot without `duration_seconds` keep the
window's close. Answers and submits are accepted until
`submission_deadline + submission.answer_grace()` (15 seconds), so the last
save a browser sends as time runs out still lands.

A background worker polls on `SUBMISSION_EXPIRY_POLL_INTERVAL` and calls
`submission.expire_overdue_attempts(limit)` in bounded batches for `created` or
`active` attempts whose grace has passed. The function is `SECURITY DEFINER`
and `FOR UPDATE SKIP LOCKED`; two worker replicas claim disjoint rows rather
than blocking each other. For each attempt, in one transaction:

- **Answers saved: time-up submit.** The latest revision of every answered item
  becomes a queued evaluation request (caller idempotency key
  `time-up:<answer revision id>`), the attempt moves to `grading`, and the
  outbox gets the same `submission.attempt_submitted.v1` and
  `submission.evaluation_requested.v1` payloads a candidate's own submit
  produces. The dispatcher grades it like any other submission.
- **Nothing saved: expired.** The attempt moves to `expired` and one
  `submission.attempt_expired.v1` event carries `attempt_id`, `tenant_id`,
  `exam_id`, `exam_version_id`, `candidate_id`, and `expired_at`.

The worker runs as `aether_submission_expiry_worker`, a dedicated least-privilege
login role provisioned in `deploy/database/platform/dev-init.sh`. It can execute
exactly one function and cannot read or write any Submission or app table
directly. A startup `Ping` self-audit confirms this posture; the service will
not start if the role has been misconfigured.

Configuration (required when `SUBMISSION_EXPIRY_ENABLED=true`):

| Variable | Default | Range | Description |
|---|---|---|---|
| `SUBMISSION_EXPIRY_ENABLED` | `false` (dev), `true` (staging/production) | bool | Enable the expiry worker. |
| `SUBMISSION_EXPIRY_DATABASE_URL` | — | — | `aether_submission_expiry_worker` credentials. |
| `SUBMISSION_EXPIRY_BATCH_SIZE` | 500 | 1–5000 | Rows expired per database call. |
| `SUBMISSION_EXPIRY_MAX_BATCHES` | 20 | 1–100 | Maximum calls per poll cycle. |
| `SUBMISSION_EXPIRY_POLL_INTERVAL` | 1m | 10s–1h | Interval between cycles. |

The worker is included in the readiness probe when enabled; the service will not
report ready until a recent cycle has completed successfully.
