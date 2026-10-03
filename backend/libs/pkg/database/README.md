# database

PostgreSQL pool management, UUIDv7 generation, migration support, durable-event
helpers, and the fail-closed tenant transaction boundary.

`IdempotencyStore` is used inside the same transaction as a business state
change and its durable outbox enqueue. It fingerprints one JSON request,
serializes concurrent uses of the key through the database unique constraint,
and stores the exact JSON response for a safe replay. Reusing a key with a
different request hash is always a conflict.

`WithTenantTx` accepts only a decoded five-second `authz.Capability`; it calls
the target database's security-definer `authz.set_context` inside the same
transaction. It never writes actor, tenant, or revision GUC values directly.
The database validates the HMAC, target audience, local projection revision,
backend PID, transaction ID, action, and resource before FORCE RLS can expose a
tenant row.

Service migrations own schemas and RLS policies; this package never bypasses
RLS, embeds credentials, or caches an allow decision.

## Migration ledger

`MigrateUp` and `MigrateDown` run only through a service's dedicated migrator
identity. Before opening `golang-migrate`, they create
`public.schema_migrations` in a short transaction after that identity uses its
permitted `SET ROLE` to the non-login database owner. The ledger remains owner-
owned; the migrator receives only `SELECT`, `INSERT`, and `TRUNCATE`, the
privileges required by `golang-migrate v4.19.1`. This preserves the
`PUBLIC`-without-`CREATE` boundary and keeps application roles out of migration
state.

Use `make migrate SVC=<service> DIR=up` rather than the generic CLI. The
disposable `make test-migrations` target proves fresh apply, full rollback, and
reapply through every non-superuser migrator.

## Soft Delete Utilities

The `softdelete.go` module provides reusable soft-delete patterns:

- **SoftDeleteScope()**: GORM scope that filters `deleted_at IS NULL`
- **IncludeDeletedScope()**: GORM scope that includes soft-deleted records
- **SoftDelete()**: Execute soft delete with audit trail (actor, reason)
- **HardDelete()**: Invoke security-definer function for SuperAdmin hard delete

### Usage Example

```go
// Default queries filter soft-deleted records
var students []Student
db.Scopes(database.SoftDeleteScope()).Where("tenant_id = ?", tenantID).Find(&students)

// Explicit archived record access (requires authorization)
var allStudents []Student
db.Scopes(database.IncludeDeletedScope()).Where("tenant_id = ?", tenantID).Find(&allStudents)

// Soft delete with audit
err := database.SoftDelete(ctx, tx, database.SoftDeleteParams{
    Table:   "users.students",
    ID:      studentID,
    Actor:   principalID,
    Reason:  "Student withdrew from program",
})

// Hard delete (SuperAdmin only, enforced via RLS)
err := database.HardDelete(ctx, tx, database.HardDeleteParams{
    Table:  "users.students",
    ID:     studentID,
    Actor:  superAdminID,
    Reason: "Retention period expired per policy",
})
```

See ADR-0013 for architecture details.
