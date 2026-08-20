# Soft Delete Implementation - SEB Service

## Overview

The SEB service implements soft delete for `configurations` and `sessions` tables. Soft delete marks records as deleted without physically removing them from the database, supporting audit requirements and recovery scenarios.

## Schema Changes

### Tables with Soft Delete

1. **seb.configurations**
   - `deleted_at timestamptz` - Timestamp when record was soft deleted
   - `deleted_by uuid` - Actor who performed the soft delete
   - `deletion_reason text` - Human-readable reason for deletion

2. **seb.sessions**
   - Same columns as above

### Tables WITHOUT Soft Delete

- `seb.key_rotations` - Append-only audit table
- `seb.validation_events` - Append-only partitioned audit log

## Cascade Behavior

When a configuration is soft deleted, all associated sessions are automatically soft deleted via the `cascade_configuration_soft_delete_trigger`:

```sql
-- Soft delete configuration
UPDATE seb.configurations
SET deleted_at = CURRENT_TIMESTAMP,
    deleted_by = '550e8400-e29b-41d4-a716-446655440000',
    deletion_reason = 'Security policy violation'
WHERE id = '<config-id>';

-- All sessions for this configuration are automatically marked:
-- deleted_at = CURRENT_TIMESTAMP
-- deleted_by = '550e8400-e29b-41d4-a716-446655440000'
-- deletion_reason = 'Cascaded from configuration soft delete'
```

## RLS Policy Updates

Soft-deleted records are automatically filtered from normal queries by RLS policies:

- **SELECT**: Only returns records where `deleted_at IS NULL`
- **UPDATE**: Can only update records where `deleted_at IS NULL`
- **DELETE**: Can only soft-delete records where `deleted_at IS NULL`

Owner role (`aether_seb_owner`) can access all records regardless of soft delete status.

## Hard Delete

Physical deletion requires `super_admin_role` and uses the `app.hard_delete()` function:

```sql
-- Hard delete (physical removal) - requires super_admin_role
SELECT app.hard_delete(
    'seb.configurations',           -- table name
    '550e8400-e29b-41d4-a716-446655440000'::uuid,  -- record id
    '650e8400-e29b-41d4-a716-446655440000'::uuid,  -- actor id (must have super_admin_role)
    'GDPR right to erasure request #12345'  -- reason (required, audited)
);
```

All hard deletes are logged in `app.hard_delete_audit_log`.

## Application Code Examples

### Soft Delete a Configuration

```go
// Soft delete
err := tx.Exec(ctx, `
    UPDATE seb.configurations
    SET deleted_at = CURRENT_TIMESTAMP,
        deleted_by = $1,
        deletion_reason = $2
    WHERE tenant_id = $3 AND id = $4
    AND deleted_at IS NULL
`, actorID, reason, tenantID, configID)
```

### Query Active (Non-Deleted) Records

```go
// RLS automatically filters soft-deleted records
rows, err := pool.Query(ctx, `
    SELECT id, exam_id, lifecycle_state, created_at
    FROM seb.configurations
    WHERE tenant_id = $1
    AND lifecycle_state = 'active'
`, tenantID)
```

### Include Soft-Deleted Records (Owner Only)

```go
// Switch to owner role to see deleted records
_, err := tx.Exec(ctx, "SET ROLE aether_seb_owner")

rows, err := tx.Query(ctx, `
    SELECT id, exam_id, lifecycle_state, deleted_at, deletion_reason
    FROM seb.configurations
    WHERE tenant_id = $1
`, tenantID)
```

### Restore a Soft-Deleted Record

```go
// Clear soft delete fields to restore
err := tx.Exec(ctx, `
    UPDATE seb.configurations
    SET deleted_at = NULL,
        deleted_by = NULL,
        deletion_reason = NULL
    WHERE tenant_id = $1 AND id = $2
`, tenantID, configID)
```

## Testing

Run the test suite to validate soft delete behavior:

```bash
# Apply migration
make migrate SVC=seb DIR=up

# Run validation tests
psql -U aether_seb_owner -d aethercode \
    -f services/seb/migrations/000010_soft_delete_schema_test.sql
```

Test coverage includes:
1. Column and index existence
2. Function and trigger creation
3. Cascade behavior (config → sessions)
4. RLS policy filtering
5. NULL default values

## Migration Files

- `000010_soft_delete_schema.up.sql` - Adds soft delete support
- `000010_soft_delete_schema.down.sql` - Removes soft delete (restores original policies)
- `000010_soft_delete_schema_test.sql` - Validation test suite

## Security Considerations

1. **RLS enforcement**: Soft-deleted records are hidden from app role by default
2. **Hard delete protection**: Requires `super_admin_role` membership check at DB layer
3. **Audit trail**: All hard deletes logged with actor, reason, and timestamp
4. **Cascade safety**: Soft delete cascades prevent orphaned sessions
5. **Immutability**: Once soft-deleted, configuration material cannot change (existing trigger)

## Related Documentation

- `PLAN.md` - Architecture and data lifecycle policies
- `migrations/README.md` - Migration history and dependencies
- `CLAUDE.md` - Development principles and conventions
