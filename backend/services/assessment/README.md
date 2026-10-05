# Assessment

Assessment owns tenant-scoped proctor-policy snapshots, exam aggregates,
immutable exam-version content, assignment rules, candidate-assignment
projections, and append-only exam security events in `aether_assessment`.

## Security boundary

Every business request follows this sequence:

1. The service forwards the bearer assertion to the canonical User
   authorization service over the configured mTLS channel.
2. The fresh allow decision yields a five-second, audience-bound database
   capability for `aether_assessment`.
3. The service opens one transaction and PostgreSQL validates the signed
   context before `FORCE ROW LEVEL SECURITY` permits a row.

The local `authz.grants_snapshot.v1` consumer replaces each principal's full
grant set atomically. If the projection has not caught up with the decision's
revision, `authz.set_context` denies access. A revoked role therefore cannot
survive a request boundary or projection lag.

Nested aggregate writes are PostgreSQL security-definer routines that verify
the exact table capability first. The app role cannot directly mutate exam
versions, sections, items, assignment rules, candidate assignments, or audit
events. Published policy and exam snapshots are immutable at both the API and
database layers.

## Workflows

- Create a proctor-policy aggregate, add canonical JSON draft versions, then
  publish a policy version.
- Create an exam aggregate, then create a draft exam version from a published
  proctor-policy version.
- Add sections and question-version snapshots using `content_version` for
  optimistic concurrency. The request carries only `question_version_id` and
  `maximum_score`; Assessment resolves the version through the Question Bank's
  private gRPC contract (`QuestionBankInternalService`) and pins the returned
  question ID plus the encrypted evaluation and sample bundles (object key,
  SHA-256, KMS key reference). Only published versions resolve: an unknown or
  unpublished version is a 404, an unreachable Question Bank a 503. Callers can
  no longer supply bundle references, and Assessment never reads Question Bank
  tables.
- Remove a draft section (`DELETE
  /v1/tenants/{tenant_id}/exam-versions/{exam_version_id}/sections/{section_id}`)
  or item (`DELETE
  /v1/tenants/{tenant_id}/exam-versions/{exam_version_id}/sections/{section_id}/items/{item_id}`),
  gated by the same draft-only, optimistic-concurrency `content_version` check
  as the add endpoints. A section that still has items cannot be removed;
  remove its items first.
- Publish only a complete, unexpired draft with at least one section and one
  item. Publication atomically updates the parent exam, writes an append-only
  `exam_events` record, and queues `assessment.exam_version.published.v1`.
- Create department, batch, placement-department, or direct-student assignment
  rules within the published exam window. Direct-student rules can be
  materialized into candidate assignments immediately.

Every state-changing endpoint requires a printable `Idempotency-Key` header.
Assessment stores a tenant- and actor-scoped request fingerprint and returns
the first committed response for an identical retry; reuse with a different
request is rejected.

Batch and department rules are expanded only from User's versioned
`user.student_batch_affiliation.snapshot.v1`, never from caller-provided
membership. The projection worker keeps `student_batch_enrollments` (newest
version wins) and materializes an assignment for each published, open rule
targeting the student's batch or its department, both when the student joins
and when a rule is created afterwards (`backfill_from_assignment_rule`). The
candidate is the student's **principal**, as every access check expects
(migration 000023); a candidate holds at most one assignment per exam version.
Placement-department rules are not expanded yet.

Direct materialization atomically persists and publishes
`assessment.candidate_assignment.snapshot.v1` (schema version 1) from the
same transaction. Revocation is an optimistic transition that increments the
assignment version and emits the same full snapshot with `lifecycle_state` set
to `revoked`. Assessment never reads or writes Submission attempts; Submission
must atomically cancel its nonterminal attempts and queued/dispatched
evaluations when it applies the newer revoked snapshot. Its payload is:

```json
{
  "tenant_id": "uuid",
  "candidate_assignment_id": "uuid",
  "candidate_id": "uuid",
  "exam_id": "uuid",
  "exam_version_id": "uuid",
  "available_from": "RFC3339 UTC timestamp",
  "available_until": "RFC3339 UTC timestamp",
  "attempt_limit": 1,
  "duration_seconds": 3600,
  "lifecycle_state": "active",
  "version": 1,
  "items": [
    {
      "exam_item_id": "uuid",
      "evaluation_bundle_object_key": "immutable object key",
      "evaluation_bundle_checksum": "lowercase SHA-256",
      "evaluation_bundle_key_reference": "KMS key reference",
      "sample_bundle_object_key": "immutable object key",
      "sample_bundle_checksum": "lowercase SHA-256",
      "sample_bundle_key_reference": "KMS key reference",
      "maximum_score": 1,
      "time_limit_ms": 2000,
      "memory_limit_kib": 262144,
      "supported_languages": ["c", "python3"]
    }
  ]
}
```

`duration_seconds` is the exam version's per-candidate time limit; Submission
sets each attempt's deadline to the earlier of its start plus this and
`available_until`. Snapshots published before migration `000025` lack it.
Items are ordered by section position then item position. This lets Submission
create and grade an attempt without reading Assessment's database. v1 exam
versions use an attempt limit of one; the stored limit is constrained to 1–20
for later policy expansion. Active snapshots always contain one or more
distinct complete item snapshots. Revoked snapshots retain their immutable
items when available; a legacy revoked assignment with incomplete historical
bundle references emits an empty `items` array, which is valid only for the
`revoked` lifecycle state. Items pinned before `000020` have null key
references and sample bundle fields, and items pinned before `000024` have null
`time_limit_ms`, `memory_limit_kib` and `supported_languages`. Those three are
the question version's execution limits and the Judge language keys a
candidate may answer in; Submission needs them to validate an answer's language
and to hand Judge the limits without calling the Question Bank during an exam.

## Collection endpoints

Three keyset-paginated list endpoints are available. All accept `limit`
(1–100, default 20) and `cursor` query parameters. An absent `next_cursor`
field in the response indicates the final page.

| Method | Path | Scope | Filter |
|--------|------|-------|--------|
| GET | `/v1/tenants/{tenant_id}/candidate-assignments` | Candidate (bearer subject bound in DB) | `lifecycle_state` |
| GET | `/v1/tenants/{tenant_id}/exams` | Staff | `lifecycle_state` |
| GET | `/v1/tenants/{tenant_id}/exams/{exam_id}/versions` | Staff | `status` |

`candidate-assignments` is candidate-scoped: the database function
`assessment.list_candidate_assignments` binds rows to
`authz.current_context_actor_id()` so a tenant staff token cannot read another
user's assignments through this endpoint.

The public operational and workflow contract is in
[api/openapi.yaml](api/openapi.yaml).

## Runtime configuration

Required for every environment:

```text
ASSESSMENT_DATABASE_URL
AUTHZ_ENDPOINT
```

`ASSESSMENT_DATABASE_URL` must authenticate as `aether_assessment_app`, never
as an owner, migrator, or projection worker. Production/staging additionally
require all three `AUTHZ_CLIENT_TLS_*` settings. When `NATS_URL` is configured
(mandatory outside development/test), configure:

```text
ASSESSMENT_PROJECTION_DATABASE_URL
```

That second connection must authenticate as
`aether_assessment_projection_worker`; it applies only local authorization
projection data. The service reports `/readyz` only when the application
database, publisher, projection database, and durable snapshot consumer are
healthy.

## Migrations

Migrations must run as `aether_assessment_migrator`, a member of the non-login
owner role. The application never owns tables and has no `BYPASSRLS` privilege.

- `000003_outbox_contract` aligns the legacy pre-release outbox with the
  shared lease/retry publisher contract.
- `000004_authorization_grant_snapshots` adds complete, revision-tombstoned
  authorization snapshots for fail-closed RLS.
- `000005_authoring_workflows` adds optimistic content versions and scoped
  aggregate routines for authoring and publication.
- `000006_candidate_assignment_snapshot` expands immutable item snapshots
  with an evaluation-bundle object key and atomically emits Submission's
  candidate-start snapshot. Existing pre-release rows require a controlled
  object-key backfill before materialization is enabled for them.
- `000007_candidate_assignment_revocation` makes the initial immutable
  content-version and v1 attempt-limit defaults explicit, centralizes full
  candidate-assignment snapshots, canonicalizes emitted checksums to
  lowercase, and adds optimistic revocation with the same versioned event
  contract.

- `000019_uuid_generate_v7` defines `extensions.uuid_generate_v7()`, which
  `000010`/`000011` call but never created, as PostgreSQL 18's built-in
  `uuidv7()`. Without it every batch, department and enrollment
  materialization failed at run time. `TestExtensionFunctionCallsResolve`
  fails if any routine calls an `extensions.*` function that does not exist.

- `000020_question_bank_resolved_bundles` adds the evaluation and sample
  bundle KMS key references to `exam_items`, replaces `add_exam_item` with an
  overload that requires both bundles fully pinned (the previous overload stays
  installed but is no longer executable by the app role), and extends the
  snapshot builders with the new item fields.

- `000024_exam_item_execution_limits` pins the resolved question version's
  `time_limit_ms`, `memory_limit_kib` and `supported_languages` on `exam_items`
  (all-or-none; null on legacy items), replaces `add_exam_item` with an
  overload that requires them (the previous one stays installed but is not
  executable by the app role), and adds the three fields to both snapshot
  builders, `enqueue_candidate_assignment_snapshot` and `materialize_candidate`.

- `000025_snapshot_duration` adds the exam version's `duration_seconds` to both
  snapshot builders.

Use `make test-migrations` to exercise fresh application, full rollback, and
reapplication with dedicated non-superuser migration logins.

## Local verification

```bash
go test ./services/assessment/...
make test-migrations
```

## Question Bank client

Assessment dials the Question Bank's internal gRPC service lazily, so it
starts without it and exam-item writes return 503 until it is reachable.

| Variable | Purpose |
|---|---|
| `ASSESSMENT_QBANK_GRPC_ADDR` | `host:port` (default `127.0.0.1:9445`) |
| `ASSESSMENT_QBANK_TLS_CERT_FILE` / `_KEY_FILE` / `_CA_FILE` | mTLS client identity and server CA; all three required in staging and production, all-or-none elsewhere (none means insecure development transport) |
| `ASSESSMENT_QBANK_TLS_SERVER_NAME` | optional TLS server name override (defaults to the address host) |

## Authorization projection recovery

`000008_authorization_projection_resync` adds a startup/recovery gate to the
complete grant projection. The projection worker writes an outbox-backed UUIDv7
request and listens only to Assessment's targeted snapshot and completion
subjects. RLS and readiness remain deny/not-ready until the complete matching
manifest is applied; `ASSESSMENT_PROJECTION_DATABASE_URL` must be the dedicated
`aether_assessment_projection_worker` credential.
