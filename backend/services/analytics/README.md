# Analytics

Analytics owns tenant-scoped, event-fed read models only. It never joins an
operational service database or accepts source code, SEB material, Judge output,
or other protected payloads.

Report-export requests are durable workflow records, not download URLs. The
public API never returns encrypted object keys, checksums, or key references;
those remain available only to the future dedicated, India-resident export
worker. That worker is intentionally not implemented by this service.

## What is implemented

- `student_progress_rollups` are rebuilt from `submission.evaluation_requested.v1`,
  `judge.completed.v1`, `submission.attempt_graded.v1`, and the immutable
  `assessment.exam_item.created.v1` question mapping. Accepted counts and
  scores therefore come from terminal Judge verdicts, not a guess based on an
  attempt's aggregate score.
- `exam_result_rollups` and placement views are built from the enriched graded
  attempt event and the User student-affiliation event. Event arrival order is
  harmless: completion records and grade records are retained locally until a
  later mapping permits a rebuild.
- Batch `started_count` is built from the durable
  `submission.attempt_started.v1` fact, independently of terminal grades. A
  completed attempt remains proof that a candidate started while the separate
  start subject is in flight, so separate durable consumers remain
  order-independent without fabricating nonterminal activity.
- Assignment, retention-policy revision, and legal-hold events are retained as
  append-only monthly event facts. A legal hold updates the retention flag
  through a narrow security-definer function; the retention purge function
  never removes held facts or exports.
- Every consumer uses a transactional inbox. The publisher uses the shared
  leased outbox contract. A complete `authz.grants_snapshot.v1` projection is
  required before `FORCE RLS` permits a protected request.
- `POST /report-exports` has required idempotency and emits the durable
  `analytics.report_export.requested.v1` outbox event. It records only a queued
  export request; a future India-resident encrypted object-storage export
  worker will be the only component allowed to attach an object key, checksum,
  and completion state.

## Report-export legal holds

`000009_report_export_legal_holds` makes a tenant-wide active legal hold apply
to every report export for that tenant, including exports requested while the
hold transition is in flight. The database serializes the hold projection and
new export request on a tenant row, marks the durable record `legal_hold=true`,
and rejects expiry, deletion, or removal/replacement of an existing encrypted
object reference while held. The retention procedure checks both the cached
flag and the serialized hold state, so a stale cache fails closed. Releasing
the hold refreshes the flag; it does not invent or run an object-storage delete
worker.

The hold projection, export request, and retention procedure consistently take
the tenant hold-state lock before a report row. The row trigger uses a
non-locking state read after PostgreSQL has locked that row, avoiding a
state/report lock-order cycle while still denying a hold already committed.

Student, assessment, and submission holds continue to protect matching
event-fact subjects. A generic report export has no reliable subject manifest,
so only a tenant-wide hold can apply to the entire export object.

Batch reports are materialized only from the authoritative
`user.student_batch_affiliation.snapshot.v1` current-membership stream. An
absent event is not membership; an inactive snapshot removes the student's
current batch contribution. For each current active batch/exam-version pair,
`assigned_count` is distinct students with an active assignment;
`started_count` is distinct students with a durable start fact tied to that
current assignment; and `completed_count` is distinct students with a terminal
graded attempt. A terminal grade also proves a start while a start event is
still being delivered, preserving `completed_count <= started_count` during
replay. `average_score` uses each student's latest graded attempt for a current
assignment. Revoked assignments and inactive batch snapshots are excluded from
all three counts.

That event is schema version 1; its only accepted fields are `tenant_id`,
`student_id`, `batch_id`, `lifecycle_state`, and positive `version`.
`batch_id` is required for `active`; `inactive` permits a UUID, omission, or
`null`, but Analytics clears it from the current-membership projection. It
rejects unknown fields and stale/equal revisions do not alter the local
snapshot.

## HTTP API

All business endpoints require a bearer assertion. For every request the
service obtains a fresh User authorization decision over mTLS and installs its
five-second signed capability in the local transaction.

| Method | Path | Required resource |
|---|---|---|
| `GET` | `/v1/tenants/{tenant_id}/student-progress/{student_id}` | `student_progress_rollups` read |
| `GET` | `/v1/tenants/{tenant_id}/exam-results?exam_version_id={uuid}` | `exam_result_rollups` read |
| `GET` | `/v1/tenants/{tenant_id}/batch-progress/{batch_id}` | `batch_progress_rollups` read |
| `GET` | `/v1/tenants/{tenant_id}/placement-progress/{placement_department_id}` | `placement_student_rollups` read |
| `POST` | `/v1/tenants/{tenant_id}/report-exports` | `report_exports` write + `Idempotency-Key` |
| `GET` | `/v1/tenants/{tenant_id}/report-exports/{export_id}` | `report_exports` read |

The full request/response contract is in [api/openapi.yaml](api/openapi.yaml).

## Event contracts consumed

| Subject | Required fields used by Analytics |
|---|---|
| `user.student.enrolled.v1` | tenant, student, college department, placement department |
| `user.student_batch_affiliation.snapshot.v1` | tenant, student, current batch or inactive state, monotonic version |
| `assessment.exam_item.created.v1` | tenant, exam item, question, question version |
| `assessment.candidate_assignment.snapshot.v1` | immutable candidate/exam snapshot and item manifest |
| `submission.evaluation_requested.v1` | evaluation request, attempt, exam item, maximum score |
| `judge.completed.v1` | tenant, evaluation request, terminal verdict |
| `submission.attempt_started.v1` | tenant, attempt, candidate, assignment, exam/version, start time |
| `submission.attempt_graded.v1` | tenant, attempt, candidate, assignment, exam/version, score, maximum score, completion time |
| `submission.attempt_cancelled.v1` | assignment-revocation audit fact for a nonterminal attempt |
| `tenant.legal_hold.placed.v1` / `.released.v1` | hold lifecycle used by retention safeguards |
| `tenant.retention_policy.updated.v1` | authoritative policy version lineage |

Consumers reject a malformed or unsupported schema-version-1 payload as a
terminal JetStream delivery. Valid events that fail their local transaction are
retried and cannot acknowledge before their inbox and projection changes commit.

## Runtime configuration

`ANALYTICS_DATABASE_URL` must use the non-owner application role.
`ANALYTICS_PROJECTION_DATABASE_URL` must use the dedicated
`aether_analytics_projection_worker` role. The usual `*_DB_MAX_CONNS` and
`*_DB_MIN_CONNS` bounds apply to each pool. `NATS_URL` and the mTLS
authorization-client variables are required in staging and production.

Run service migrations through the dedicated migrator, then start the service:

```sh
go run ./services/analytics/cmd/server
```

Useful verification commands from the repository root:

```sh
go test ./services/analytics/...
make test-migrations
```

## Authorization projection recovery

`000007_authorization_projection_resync` ensures analytics read-model RLS
never trusts a retained grant projection after a stream-recovery gap. The
dedicated projection worker requests and consumes only Analytics's targeted
batch; it is ready only after the entire count/SHA-256 manifest matches.
`ANALYTICS_PROJECTION_DATABASE_URL` must authenticate as
`aether_analytics_projection_worker` whenever `NATS_URL` is configured.
