# SEB migrations

Apply paired migrations with `aether_seb_migrator`:

```sh
make migrate SVC=seb DIR=up
```

`000003_outbox_contract` upgrades the original outbox to the shared leased,
checksum-protected publisher schema. `000004_authorization_grant_snapshots`
adds RLS helpers, projection tables, and the complete-manifest gate; the service
fails closed until the first complete `authz.grants_snapshot.v1` is applied.

`000005_security_workflows` provides multi-table procedures for rotation,
revocation, session issuance, and header validation. Each procedure is
security-definer and re-checks the caller's signed `seb.write` capability.

`000006_self_session_validation` replaces the formerly event-ID-authorized
validation procedure with `AuthorizeSelfHTTP`: the User authorization service
signs only `/validation_events/:id`, and the procedure independently binds that
RLS actor to `seb.sessions.candidate_id`.

`000007_authorization_projection_resync` adds the targeted complete-grant
recovery ledger and makes the existing authorization helper fail closed until
the User manifest verifies. Only `aether_seb_projection_worker` can start or
apply that recovery protocol.

`000008_database_connect_privileges` grants the application role and projection
worker explicit `CONNECT` on `aether_seb`, then revokes `PUBLIC` connect to
enforce role-based access.

`000009_session_lifecycle_projection` adds the read-model projection table
tracking active/expiring sessions for monitoring and cleanup workflows.

`000010_soft_delete_schema` adds soft delete columns (`deleted_at`, `deleted_by`,
`deletion_reason`) to `seb.configurations` and `seb.sessions`. Includes cascade
trigger (soft-deleting a configuration soft-deletes its sessions), the shared
`app.hard_delete()` function with `super_admin_role` check, and RLS policy
updates to filter soft-deleted records from default queries. Run the companion
test file `000010_soft_delete_schema_test.sql` to validate.

`000014_exam_networks` adds `exam_policies.allowed_networks` (ADR-0030) and a
five-argument `check_exam_request` that also takes the client address: while a
candidate has an open assignment to an exam with networks, a request from
outside them returns `network_refused`; otherwise it answers as the
four-argument check does. Rollback drops both.
