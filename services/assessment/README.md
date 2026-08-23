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
  optimistic concurrency. Question IDs, encrypted evaluation-bundle object
  references, and checksums are opaque; Assessment never reads Question Bank
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

Department, batch, and placement rules are deliberately not expanded from
caller-provided affiliation data. They remain durable rules until an
authoritative, versioned User affiliation projection is available; that avoids
creating candidate access from stale or untrusted membership data.

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
  "lifecycle_state": "active",
  "version": 1,
  "items": [
    {
      "exam_item_id": "uuid",
      "evaluation_bundle_object_key": "immutable object key",
      "evaluation_bundle_checksum": "lowercase SHA-256",
      "maximum_score": 1
    }
  ]
}
```

Items are ordered by section position then item position. This lets Submission
create and grade an attempt without reading Assessment's database. v1 exam
versions use an attempt limit of one; the stored limit is constrained to 1–20
for later policy expansion. Active snapshots always contain one or more
distinct complete item snapshots. Revoked snapshots retain their immutable
items when available; a legacy revoked assignment with incomplete historical
bundle references emits an empty `items` array, which is valid only for the
`revoked` lifecycle state.

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

Use `make test-migrations` to exercise fresh application, full rollback, and
reapplication with dedicated non-superuser migration logins.

## Local verification

```bash
go test ./services/assessment/...
make test-migrations
```

## Authorization projection recovery

`000008_authorization_projection_resync` adds a startup/recovery gate to the
complete grant projection. The projection worker writes an outbox-backed UUIDv7
request and listens only to Assessment's targeted snapshot and completion
subjects. RLS and readiness remain deny/not-ready until the complete matching
manifest is applied; `ASSESSMENT_PROJECTION_DATABASE_URL` must be the dedicated
`aether_assessment_projection_worker` credential.
