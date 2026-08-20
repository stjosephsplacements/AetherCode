# Soft Delete Implementation Report - SEB Service

**Migration**: `000010_soft_delete_schema`  
**Date**: 2026-07-25  
**Status**: Complete  

## Summary

Implemented soft delete functionality for the SEB (Safe Exam Browser) service following the established pattern from other services (User, Question Bank, Submission). This closes Gap #2 in the soft delete rollout.

## Files Created

### Migration Files
1. **000010_soft_delete_schema.up.sql** (153 lines, 5.3KB)
   - Adds `deleted_at`, `deleted_by`, `deletion_reason` columns to `configurations` and `sessions`
   - Creates partial indexes on `deleted_at` for performance
   - Implements cascade trigger: soft-deleting a configuration automatically soft-deletes its sessions
   - Creates/ensures `app.hard_delete()` function exists with `super_admin_role` guard
   - Creates/ensures `app.hard_delete_audit_log` table exists
   - Updates RLS policies to filter soft-deleted records from default queries
   - Grants execute permission on `app.hard_delete` to `aether_seb_app`

2. **000010_soft_delete_schema.down.sql** (61 lines, 2.7KB)
   - Drops cascade trigger and function
   - Conditionally drops shared `app.hard_delete()` and audit log (with warning comment)
   - Restores original RLS policies without soft delete filter
   - Removes soft delete columns and indexes
   - Full rollback capability

3. **000010_soft_delete_schema_test.sql** (199 lines, 6.4KB)
   - 7 comprehensive test cases validating:
     - Column existence
     - Index creation
     - Function existence
     - Trigger functionality
     - Cascade behavior (config → sessions)
     - RLS policy updates
     - NULL default values
   - All tests run in a transaction (ROLLBACK at end)
   - Safe to run repeatedly

### Documentation Files
4. **SOFT_DELETE.md** (comprehensive usage guide)
   - Schema changes overview
   - Cascade behavior documentation
   - RLS policy impact
   - Hard delete procedures
   - Code examples (SQL and Go)
   - Testing instructions
   - Security considerations

5. **000010_IMPLEMENTATION_REPORT.md** (this file)

### Updated Files
6. **migrations/README.md**
   - Added entry for migration `000010` with description

## Design Decisions

### Tables Included
- ✅ `seb.configurations` - Core configuration records
- ✅ `seb.sessions` - Exam browser sessions
- ❌ `seb.key_rotations` - Append-only audit table, no soft delete needed
- ❌ `seb.validation_events` - Append-only partitioned audit log, no soft delete needed

### Cascade Logic
Implemented `cascade_configuration_soft_delete_trigger`:
- When a configuration is soft deleted, all its sessions are automatically soft deleted
- Prevents orphaned sessions referencing deleted configurations
- Cascade reason: "Cascaded from configuration soft delete"
- Maintains audit trail of deletion source

### RLS Policy Updates
Updated policies for both `configurations` and `sessions`:
- **Read**: Filters `WHERE deleted_at IS NULL` (hides soft-deleted records)
- **Update**: Restricts `USING (... AND deleted_at IS NULL)` (can't modify deleted)
- **Delete**: Restricts `USING (... AND deleted_at IS NULL)` (can't re-delete)
- Owner role bypasses all filters (for recovery/audit)

### Hard Delete Protection
Implemented via `app.hard_delete()`:
- Requires `pg_has_role(actor, 'super_admin_role', 'MEMBER')` check at DB layer
- No cross-schema dependency (uses PostgreSQL role system directly)
- All hard deletes logged to `app.hard_delete_audit_log`
- Returns boolean indicating success

## Security Analysis

### Defense-in-Depth Layers
1. **Application layer**: Authorization service checks before calling soft delete
2. **RLS layer**: Policies enforce tenant isolation and soft delete filtering
3. **Database layer**: `pg_has_role()` check in `app.hard_delete()` for physical deletion
4. **Audit layer**: All hard deletes permanently logged

### Tenant Isolation
- Soft delete columns do NOT bypass existing tenant isolation
- RLS policies still enforce `tenant_id` checks first
- Soft delete is an additional filter: `(tenant_id = X) AND (deleted_at IS NULL)`

### Immutability Preserved
- Existing `reject_configuration_material_mutation()` trigger still active
- Soft-deleted configurations cannot modify material fields
- Soft delete is append-only: sets columns once, no re-deletion

## Testing Strategy

### Test Coverage
1. **Schema validation**: Columns, indexes, functions, triggers exist
2. **Cascade behavior**: Configuration soft delete → session soft delete
3. **RLS policies**: Correct policy names and filtering behavior
4. **Default values**: New records have NULL soft delete fields
5. **Isolation**: Test data cleanup in transaction rollback

### How to Run
```bash
# Apply migration
make migrate SVC=seb DIR=up

# Run tests
psql -U aether_seb_owner -d aethercode \
    -f services/seb/migrations/000010_soft_delete_schema_test.sql

# Expected output: "All tests PASSED"
```

## Migration Safety

### Backward Compatibility
- ✅ Adds nullable columns (no data migration needed)
- ✅ Existing queries work unchanged (NULL = not deleted)
- ✅ RLS policies updated without service restart needed
- ✅ Indexes created concurrently-safe (partial indexes, small initial size)

### Rollback Safety
- ✅ Down migration provided
- ✅ Restores original policies exactly
- ⚠️  Drops `app.hard_delete()` and audit log (may be shared by other services)
- 📝 Comment added warning about shared objects

### Performance Impact
- Minimal: Added 3 columns per table (12 bytes nullable)
- Partial indexes only on deleted records (expected to be small)
- RLS policy adds `AND deleted_at IS NULL` check (highly selective)

## Integration Points

### Shared Objects
Created/ensured existence of:
- `app.hard_delete_audit_log` table
- `app.hard_delete(text, uuid, uuid, text)` function

These are shared across services. Other services (User, Question Bank, Submission) also create these with `CREATE IF NOT EXISTS` / `CREATE OR REPLACE`, so multiple migrations can safely run.

### Dependencies
- Requires PostgreSQL role `super_admin_role` to exist (created in bootstrap)
- Requires `aether_seb_owner` and `aether_seb_app` roles
- Requires `authz.current_context_allows*` functions (from authorization projection)

## Follow-Up Tasks

### Application Code Updates (Not in Scope)
This migration provides the schema foundation. Application code updates needed:
1. Add soft delete methods to repository interface
2. Update service layer to use soft delete instead of hard delete
3. Add admin endpoints for viewing/restoring soft-deleted records
4. Add hard delete endpoint with `super_admin_role` authorization check
5. Update API documentation

### Monitoring (Future)
Consider adding:
- Metrics: count of soft-deleted records by table
- Alerts: unusual spike in deletions
- Cleanup job: archive very old soft-deleted records

## Validation Checklist

- [x] Migration files created (up, down, test)
- [x] Documentation written (SOFT_DELETE.md)
- [x] migrations/README.md updated
- [x] Down migration tested for completeness
- [x] Test file covers all schema changes
- [x] RLS policies correctly filter soft deletes
- [x] Cascade trigger implemented
- [x] Hard delete function has role check
- [x] Audit log created
- [x] No secrets or placeholders committed
- [x] Follows existing service patterns
- [x] Security reviewed (tenant isolation, immutability)

## References

Pattern established in:
- `services/user/migrations/000017_soft_delete_schema.*.sql`
- `services/question-bank/migrations/000006_soft_delete_schema.*.sql`
- `services/submission/migrations/000013_soft_delete_schema.*.sql`

See `PLAN.md` for overall architecture and `CLAUDE.md` for development principles.
