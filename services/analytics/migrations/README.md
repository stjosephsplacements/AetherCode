# Analytics migrations

Apply paired migrations with `aether_analytics_migrator`:

```sh
make migrate SVC=analytics DIR=up
```

`000007_authorization_projection_resync` adds a durable, target-bound grant
bootstrap request and a manifest-gated RLS projection state. Only
`aether_analytics_projection_worker` can operate the recovery tables; analytics
read models remain denied until the matching User batch completes.

`000008_attempt_started_projection` retains immutable Submission start facts
for active-assignment batch reporting and replaces the batch rebuild routine.
Its rebuild is replay-safe across subjects: terminal grades temporarily prove a
start while the independent start fact is still in transit. Rollback refuses
once a start projection or distinct started/completed batch count exists.

`000009_report_export_legal_holds` adds a tenant-scoped serialized legal-hold
state for report exports. Tenant hold placement/release refreshes export flags
atomically, while the lifecycle trigger and retention function deny expiry or
deletion under a hold. The application role loses table-wide export reads and
can select only non-storage metadata; encrypted object references remain
reserved for a future dedicated worker. Rollback refuses while any tenant hold
or held export remains.

`000012_soft_delete_schema` adds soft delete columns (deleted_at, deleted_by,
deletion_reason) to report_exports and creates the shared hard_delete_audit_log
table and app.hard_delete function for super_admin-only physical deletions.
Updates RLS policies to exclude soft-deleted records from normal queries while
allowing owner role to access all records for maintenance. Event-fed projection
tables remain immutable (no soft delete) as they rebuild from source events.
