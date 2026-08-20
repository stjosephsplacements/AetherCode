# Deployment Checklist - SEB Soft Delete (000010)

## Pre-Deployment

- [ ] Review all migration files:
  - [ ] `000010_soft_delete_schema.up.sql`
  - [ ] `000010_soft_delete_schema.down.sql`
  - [ ] `000010_soft_delete_schema_test.sql`

- [ ] Verify PostgreSQL prerequisites:
  - [ ] `super_admin_role` exists in target database
  - [ ] `aether_seb_owner` role exists and has proper permissions
  - [ ] `aether_seb_app` role exists
  - [ ] `authz.current_context_allows*` functions exist (from previous migrations)

- [ ] Check if shared objects already exist (from other services):
  - [ ] `app.hard_delete_audit_log` table
  - [ ] `app.hard_delete()` function
  - [ ] If yes, migration will use them (CREATE IF NOT EXISTS / CREATE OR REPLACE)

## Deployment Steps

### 1. Backup (Production Only)
```bash
pg_dump -U aether_seb_owner -d aethercode \
    -t seb.configurations \
    -t seb.sessions \
    --file=seb_pre_softdelete_backup.sql
```

### 2. Apply Migration
```bash
# Development
make migrate SVC=seb DIR=up

# Production (verify first)
migrate -path services/seb/migrations \
    -database "postgresql://aether_seb_migrator:PASSWORD@HOST:5432/aethercode?sslmode=require" \
    up
```

### 3. Verify Migration
```bash
psql -U aether_seb_owner -d aethercode \
    -f services/seb/migrations/000010_soft_delete_schema_test.sql
```

Expected output: `All tests PASSED`

### 4. Smoke Test Queries
```sql
-- Connect as owner
psql -U aether_seb_owner -d aethercode

-- Check columns exist
\d seb.configurations
\d seb.sessions

-- Check indexes
\di seb.configurations_deleted_at_idx
\di seb.sessions_deleted_at_idx

-- Check trigger
SELECT tgname, tgrelid::regclass
FROM pg_trigger
WHERE tgname = 'cascade_configuration_soft_delete_trigger';

-- Check function
\df app.hard_delete

-- Verify RLS policies
\d+ seb.configurations
\d+ seb.sessions
```

## Post-Deployment

### Verify RLS Behavior
```sql
SET ROLE aether_seb_app;

-- Should return only non-deleted records
SELECT count(*) FROM seb.configurations;
SELECT count(*) FROM seb.sessions;

-- Create test soft delete (replace with real tenant/config)
UPDATE seb.configurations
SET deleted_at = CURRENT_TIMESTAMP,
    deleted_by = '<actor-uuid>',
    deletion_reason = 'Test deployment'
WHERE id = '<test-config-id>';

-- Verify it's hidden from app role
SELECT count(*) FROM seb.configurations WHERE id = '<test-config-id>';
-- Should return 0

RESET ROLE;

-- Verify owner can see it
SELECT deleted_at, deletion_reason
FROM seb.configurations
WHERE id = '<test-config-id>';
-- Should show the deleted record

-- Restore test record
UPDATE seb.configurations
SET deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL
WHERE id = '<test-config-id>';
```

### Application Integration Checks
- [ ] Service starts successfully with new schema
- [ ] Existing queries work (NULL values treated as not deleted)
- [ ] No performance degradation on configuration/session queries
- [ ] Logs show no RLS policy violations

### Monitoring
- [ ] Check for increased query latency (partial index should make this negligible)
- [ ] Verify no blocked queries or lock contention
- [ ] Check application error logs for unexpected RLS denials

## Rollback Procedure (If Needed)

### Before Rollback
⚠️ **WARNING**: If other services already use `app.hard_delete()` or `app.hard_delete_audit_log`, comment out those DROP statements in the down migration before running!

### Rollback Steps
```bash
# Development
make migrate SVC=seb DIR=down

# Production
migrate -path services/seb/migrations \
    -database "postgresql://aether_seb_migrator:PASSWORD@HOST:5432/aethercode?sslmode=require" \
    down 1
```

### Verify Rollback
```sql
-- Columns should be gone
\d seb.configurations
\d seb.sessions

-- Trigger should be gone
SELECT count(*) FROM pg_trigger
WHERE tgname = 'cascade_configuration_soft_delete_trigger';
-- Should return 0

-- Policies should be restored (no deleted_at filter)
SELECT * FROM pg_policies
WHERE tablename IN ('configurations', 'sessions')
AND schemaname = 'seb';
```

## Troubleshooting

### Issue: Migration fails with "role super_admin_role does not exist"
**Solution**: Create the role first (typically done in bootstrap)
```sql
CREATE ROLE super_admin_role;
```

### Issue: Cascade trigger not firing
**Check**:
1. Trigger exists: `SELECT * FROM pg_trigger WHERE tgname LIKE '%cascade%';`
2. Function exists: `\df seb.cascade_configuration_soft_delete`
3. Test manually:
```sql
UPDATE seb.configurations
SET deleted_at = CURRENT_TIMESTAMP, deleted_by = '<uuid>', deletion_reason = 'Test'
WHERE id = '<config-id>';

-- Check sessions
SELECT deleted_at, deletion_reason FROM seb.sessions WHERE configuration_id = '<config-id>';
```

### Issue: Hard delete fails with "permission denied"
**Check**:
1. Actor has super_admin_role membership:
```sql
SELECT pg_has_role('<actor-uuid>'::text, 'super_admin_role', 'MEMBER');
```
2. If false, grant the role:
```sql
GRANT super_admin_role TO '<actor-uuid>';
```

### Issue: Soft-deleted records still visible
**Check**:
1. Connected as app role (not owner): `SELECT current_user;`
2. RLS enabled: `\d+ seb.configurations`
3. Policies exist: `\d+ seb.configurations` (look for Policies section)
4. Record is actually soft-deleted:
```sql
SET ROLE aether_seb_owner;
SELECT deleted_at FROM seb.configurations WHERE id = '<id>';
```

## Success Criteria

- [ ] All tests pass (`000010_soft_delete_schema_test.sql`)
- [ ] Smoke tests successful
- [ ] Service restarts without errors
- [ ] RLS correctly filters soft-deleted records
- [ ] Cascade trigger works (config → sessions)
- [ ] Hard delete requires super_admin_role
- [ ] No performance degradation
- [ ] Rollback tested in dev environment (optional but recommended)

## Documentation References

- Migration implementation: `000010_IMPLEMENTATION_REPORT.md`
- Usage guide: `SOFT_DELETE.md`
- Migration history: `migrations/README.md`
- Architecture: `PLAN.md`

## Team Sign-Off

- [ ] DBA reviewed and approved
- [ ] Security reviewed (RLS policies, role checks)
- [ ] Dev team notified of new schema
- [ ] Documentation updated
- [ ] Deployment scheduled

---

**Migration Number**: 000010  
**Migration Name**: soft_delete_schema  
**Service**: SEB (Safe Exam Browser)  
**Date**: 2026-07-25  
**Checklist Version**: 1.0
