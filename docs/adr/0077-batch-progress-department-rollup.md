# ADR-0077: Department-sliced batch progress rollup as a separate table

- Status: accepted
- Date: 2026-11-08

## Context

`analytics.batch_progress_rollups` has the PK `(tenant_id, batch_id, exam_version_id)`.
A college batch can span multiple departments: a student's `college_department_id` lives in
`student_affiliation_projections`, which is a separate event-fed projection from the User service.
The batch rollup was designed before department-scoped staff capabilities existed; it never
joined `student_affiliation_projections` so there is no department dimension.

The consequence: a department-scoped staff member whose RBAC capability lists only their
department UUID cannot derive their slice from `batch_progress_rollups`. The staff analytics
page works around this client-side by fetching the full rollup and discarding rows belonging
to other departments, which (a) leaks cross-department row counts and (b) is incorrect once
RLS node-scoped policies are tightened to enforce department isolation.

## Decision

Add `analytics.batch_progress_department_rollups` with PK
`(tenant_id, batch_id, department_id, exam_version_id)` (migration 000019).

- **Separate table, not a new column on `batch_progress_rollups`**: adding `department_id`
  to an existing `(batch_id, exam_version_id)` rollup changes its meaning from a
  batch-level aggregate to a department-level slice and requires rebuilding every existing
  row. A separate table keeps both aggregations available without a destructive migration.
- **department_id source**: `student_affiliation_projections.college_department_id`, which
  is the authoritative department snapshot owned by the User service and consumed by
  Analytics via event projection.
- **Rebuild trigger**: the projection worker calls `rebuild_batch_progress_by_department`
  immediately after `rebuild_batch_progress` in every transaction that rebuilds a batch.
  Both functions take the same advisory lock key `(tenant_id, batch_id)` so they serialise.
- **RLS**: tenant-level signed read/write policies identical to `batch_progress_rollups`,
  plus a batch-node-scoped read policy matching the pattern from migration 000017.
- **HTTP endpoint**: `GET /v1/tenants/{tid}/batch-progress/{batch_id}/by-department`
  uses `batch_progress_department_rollups` as the resource name in the RBAC check,
  so a capability scoped to `batch_progress_department_rollups` and the batch node
  can read only the rows for that batch — by all departments.

## Consequences

- Department-scoped staff capabilities can query the new endpoint and receive only their
  slice without client-side filtering.
- The existing `GET /v1/tenants/{tid}/batch-progress/{batch_id}` endpoint is unchanged;
  it still returns the batch-total rollup.
- Migration 000019 must be applied before deploying the updated analytics image; the new
  table starts empty and fills progressively as the projection worker processes events or
  is triggered by a full rebuild.
- The `rebuild_batch_progress_by_department` function depends on
  `analytics.student_affiliation_projections` (migration 000005). If a student has no
  affiliation snapshot yet, their counts do not appear in this table (same semantics as
  `placement_student_rollups`).
