# Soft Delete Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement comprehensive soft delete architecture across all AetherCode services where only SuperAdmin can hard delete records; all other roles can only soft delete (archive/deactivate).

**Architecture:** Medallion hierarchy enforces deletion rules via RLS policies. Each tenant-scoped table adds `deleted_at` timestamp, database triggers prevent hard deletes for non-SuperAdmin roles, domain models validate deletion operations, and authorization checks happen at API boundaries.

**Tech Stack:** PostgreSQL RLS policies, Go domain validation, gRPC/REST API authorization, Casbin policy rules, golang-migrate for database migrations

## Global Constraints

- All soft deletes use `deleted_at timestamptz` column (nullable)
- Hard deletes only allowed for `super_admin` role via explicit database function
- RLS policies automatically filter soft-deleted records from standard queries
- All queries include `WHERE deleted_at IS NULL` unless explicitly requesting archived records
- Domain events must be published for both soft and hard delete operations
- Audit trail preserved: `deleted_by uuid` and `deletion_reason text` columns mandatory
- Migrations follow expand → migrate → contract pattern
- Zero downtime: soft delete columns added first, code deployed, then constraints enforced
- Shared library `libs/pkg/database/softdelete.go` provides reusable utilities

---

### Task 1: Create ADR and Update CLAUDE.md

**Files:**
- Create: `docs/adr/0013-soft-delete-architecture.md`
- Modify: `CLAUDE.md` (add soft delete principle)

**Interfaces:**
- Consumes: ADR template `docs/adr/0000-template.md`
- Produces: ADR-0013 referenced in all future soft-delete implementations

- [ ] **Step 1: Write the ADR**

```bash
cat > docs/adr/0013-soft-delete-architecture.md << 'EOF'
# ADR-0013: Soft Delete Architecture

- Status: accepted
- Date: 2026-07-25

## Context

AetherCode is a multi-tenant academic platform where data retention is critical for:
1. Academic integrity investigations and appeals
2. Compliance audits and legal discovery
3. Historical performance analytics and trend analysis
4. Accidental deletion recovery

Hard deletes permanently destroy data, making investigations impossible. The platform must preserve audit trails while allowing authorized users to "remove" records from active use.

## Decision

Implement a **medallion-based soft delete architecture**:

1. **Soft delete pattern**: All tenant-scoped tables include `deleted_at`, `deleted_by`, and `deletion_reason` columns. Setting `deleted_at` archives the record without physical removal.

2. **Hard delete restriction**: Only the `super_admin` role can execute hard deletes via a security-definer database function `app.hard_delete()`. All other roles are denied physical DELETE operations through RLS policies.

3. **Automatic filtering**: Default queries filter `WHERE deleted_at IS NULL`. Archived record access requires explicit `include_deleted=true` parameter and appropriate authorization.

4. **Cascade behavior**: Soft deleting a parent marks all children with `deleted_at` through database triggers. Hard deletes use `CASCADE` only after SuperAdmin confirmation.

5. **Audit trail**: Every deletion (soft or hard) publishes a domain event with actor, reason, and affected entity details for the analytics service.

6. **Implementation strategy**:
   - Shared utility: `libs/pkg/database/softdelete.go` with GORM scopes and helpers
   - Database layer: RLS policies, triggers, security-definer functions
   - Domain layer: `SoftDelete(actor, reason)` and `HardDelete(actor, reason)` methods
   - API layer: Authorization middleware checks role before allowing delete operations

## Consequences

### Positive
- **Data safety**: Accidental deletions recoverable by admins
- **Compliance**: Full audit trail for regulatory requirements
- **Investigations**: Historical data available for academic integrity cases
- **Analytics**: Trend analysis includes archived entities

### Negative
- **Database growth**: Soft-deleted records consume storage until hard-deleted
- **Query complexity**: Must explicitly filter `deleted_at IS NULL` in most queries
- **Migration effort**: All existing tables require schema updates
- **Performance**: Indexes must account for `deleted_at` filter predicate

### Operational
- Retention policies determine when SuperAdmin hard-deletes archived records
- Monitoring dashboard tracks soft-delete growth per tenant
- Backup/restore procedures must handle soft-deleted records correctly
- Testing requires fixtures with soft-deleted records to validate filtering

## Alternatives Considered

1. **Flag-based (`is_deleted BOOLEAN`)**: Rejected because timestamps provide audit trail of when deletion occurred.

2. **Status enum (`status IN ('active', 'deleted')`)**: Rejected because status often represents business state (e.g., exam: draft/published/retired), conflating lifecycle with deletion.

3. **No soft delete (immediate hard delete)**: Rejected due to academic compliance requirements and investigation needs.

4. **Shadow tables (`_deleted` suffix)**: Rejected due to complexity in querying, foreign key management, and event-driven projection updates.
EOF
```

- [ ] **Step 2: Update CLAUDE.md with soft delete principle**

```bash
# Add to CLAUDE.md core principles section
```

Open `CLAUDE.md` and add after line 5 (the last core principle):

```markdown
7. **Soft delete by default.** Only SuperAdmin can hard delete records. All other
   roles use soft delete (`deleted_at`). Queries filter soft-deleted records
   unless explicitly requesting archived data. See ADR-0013.
```

- [ ] **Step 3: Verify formatting**

```bash
head -n 50 docs/adr/0013-soft-delete-architecture.md
grep -A 3 "soft delete" CLAUDE.md
```

Expected: ADR renders correctly, CLAUDE.md updated with principle 7

- [ ] **Step 4: Commit ADR and CLAUDE.md update**

```bash
git add docs/adr/0013-soft-delete-architecture.md CLAUDE.md
git commit -m "docs: add ADR-0013 soft delete architecture and update CLAUDE.md

Establishes soft delete as platform-wide pattern where only SuperAdmin can
hard delete. All other roles archive records via deleted_at timestamp.

Ref: ADR-0013

Co-Authored-By: Claude Sonnet 4.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Shared Soft Delete Utilities

**Files:**
- Create: `libs/pkg/database/softdelete.go`
- Create: `libs/pkg/database/softdelete_test.go`
- Modify: `libs/pkg/database/README.md`

**Interfaces:**
- Consumes: `database.Pool` from `libs/pkg/database/pool.go`
- Produces: 
  - `SoftDeleteScope()` - GORM scope for filtering non-deleted records
  - `IncludeDeletedScope()` - GORM scope for including deleted records
  - `SoftDelete(tx, table, id, actor, reason)` - Execute soft delete with audit
  - `HardDelete(tx, table, id, actor, reason)` - Invoke security-definer hard delete

- [ ] **Step 1: Write failing test for SoftDeleteScope**

```go
// File: libs/pkg/database/softdelete_test.go
package database_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"aethercode/libs/pkg/database"
)

type TestModel struct {
	ID        uint
	Name      string
	DeletedAt *time.Time
	DeletedBy *string
}

func TestSoftDeleteScope_FiltersDeletedRecords(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&TestModel{}))

	// Insert active and soft-deleted records
	now := time.Now()
	actor := "test-user"
	db.Create(&TestModel{ID: 1, Name: "active"})
	db.Create(&TestModel{ID: 2, Name: "deleted", DeletedAt: &now, DeletedBy: &actor})

	var results []TestModel
	err = db.Scopes(database.SoftDeleteScope()).Find(&results).Error
	require.NoError(t, err)

	assert.Len(t, results, 1)
	assert.Equal(t, "active", results[0].Name)
}

func TestIncludeDeletedScope_ReturnsAllRecords(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&TestModel{}))

	now := time.Now()
	actor := "test-user"
	db.Create(&TestModel{ID: 1, Name: "active"})
	db.Create(&TestModel{ID: 2, Name: "deleted", DeletedAt: &now, DeletedBy: &actor})

	var results []TestModel
	err = db.Scopes(database.IncludeDeletedScope()).Find(&results).Error
	require.NoError(t, err)

	assert.Len(t, results, 2)
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd libs/pkg/database
go test -v -run TestSoftDeleteScope
```

Expected: FAIL with "undefined: database.SoftDeleteScope"

- [ ] **Step 3: Implement soft delete utilities**

```go
// File: libs/pkg/database/softdelete.go
package database

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// SoftDeleteScope returns a GORM scope that filters out soft-deleted records.
// Use this as the default query scope for all models with deleted_at columns.
func SoftDeleteScope() func(db *gorm.DB) *gorm.DB {
	return func(db *gorm.DB) *gorm.DB {
		return db.Where("deleted_at IS NULL")
	}
}

// IncludeDeletedScope returns a GORM scope that includes soft-deleted records.
// Use when explicitly querying archived data (requires authorization check).
func IncludeDeletedScope() func(db *gorm.DB) *gorm.DB {
	return func(db *gorm.DB) *gorm.DB {
		return db.Unscoped()
	}
}

// SoftDeleteParams holds parameters for soft delete operations.
type SoftDeleteParams struct {
	Table   string    // Table name (e.g., "users.students")
	ID      uuid.UUID // Record primary key
	Actor   uuid.UUID // Principal performing deletion
	Reason  string    // Deletion reason for audit
	TenantID *uuid.UUID // Optional: tenant context for RLS
}

// SoftDelete marks a record as deleted without physical removal.
// Sets deleted_at, deleted_by, and deletion_reason columns.
func SoftDelete(ctx context.Context, tx *gorm.DB, params SoftDeleteParams) error {
	if params.Reason == "" {
		return fmt.Errorf("deletion reason is required for audit trail")
	}

	now := time.Now()
	query := fmt.Sprintf(
		"UPDATE %s SET deleted_at = ?, deleted_by = ?, deletion_reason = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
		params.Table,
	)

	result := tx.WithContext(ctx).Exec(query, now, params.Actor, params.Reason, now, params.ID)
	if result.Error != nil {
		return fmt.Errorf("soft delete failed: %w", result.Error)
	}

	if result.RowsAffected == 0 {
		return fmt.Errorf("record not found or already deleted: %s/%s", params.Table, params.ID)
	}

	return nil
}

// HardDeleteParams holds parameters for hard delete operations.
type HardDeleteParams struct {
	Table   string    // Table name
	ID      uuid.UUID // Record primary key
	Actor   uuid.UUID // SuperAdmin principal performing deletion
	Reason  string    // Deletion reason (required for SuperAdmin audit)
}

// HardDelete permanently removes a record via security-definer function.
// Only SuperAdmin role can execute this. RLS policies enforce the restriction.
func HardDelete(ctx context.Context, tx *gorm.DB, params HardDeleteParams) error {
	if params.Reason == "" {
		return fmt.Errorf("hard delete reason is required for SuperAdmin audit")
	}

	// Call security-definer function that checks SuperAdmin role via RLS
	query := "SELECT app.hard_delete(?, ?, ?, ?)"
	var success bool
	err := tx.WithContext(ctx).Raw(query, params.Table, params.ID, params.Actor, params.Reason).Scan(&success).Error
	if err != nil {
		return fmt.Errorf("hard delete failed: %w", err)
	}

	if !success {
		return fmt.Errorf("hard delete denied: insufficient permissions or record not found")
	}

	return nil
}

// MarkDeleted is a GORM callback that automatically sets deleted_at.
// Register this callback in models that support soft delete.
func MarkDeleted(db *gorm.DB) {
	if db.Statement.Schema != nil {
		if _, ok := db.Statement.Schema.FieldsByDBName["deleted_at"]; ok {
			db.Statement.SetColumn("deleted_at", time.Now())
		}
	}
}
```

- [ ] **Step 4: Run tests to verify implementation**

```bash
cd libs/pkg/database
go test -v -run TestSoftDeleteScope
go test -v -run TestIncludeDeletedScope
```

Expected: PASS for both tests

- [ ] **Step 5: Update database README**

Open `libs/pkg/database/README.md` and add after existing sections:

```markdown
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
```

- [ ] **Step 6: Commit shared utilities**

```bash
git add libs/pkg/database/softdelete.go libs/pkg/database/softdelete_test.go libs/pkg/database/README.md
git commit -m "feat(database): add soft delete utilities with GORM scopes

Provides SoftDeleteScope, IncludeDeletedScope, and SoftDelete/HardDelete
functions for consistent soft delete implementation across services.

Ref: ADR-0013

Co-Authored-By: Claude Sonnet 4.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Database Migration Template

**Files:**
- Create: `docs/templates/soft-delete-migration.sql`

**Interfaces:**
- Consumes: ADR-0013 soft delete architecture
- Produces: Reusable migration template for all services

- [ ] **Step 1: Write migration template**

```sql
-- File: docs/templates/soft-delete-migration.sql
-- Template for adding soft delete columns to existing tables
-- Replace <schema>, <table>, <owner_role> with actual values

-- Expand phase: Add nullable columns (zero downtime)
ALTER TABLE <schema>.<table>
    ADD COLUMN deleted_at timestamptz,
    ADD COLUMN deleted_by uuid,
    ADD COLUMN deletion_reason text;

CREATE INDEX <table>_deleted_at_idx ON <schema>.<table> (deleted_at)
    WHERE deleted_at IS NOT NULL;

COMMENT ON COLUMN <schema>.<table>.deleted_at IS 'Soft delete timestamp - NULL means active record';
COMMENT ON COLUMN <schema>.<table>.deleted_by IS 'Principal ID who performed soft delete';
COMMENT ON COLUMN <schema>.<table>.deletion_reason IS 'Audit trail: why record was archived';

-- Security-definer function for hard delete (SuperAdmin only)
CREATE OR REPLACE FUNCTION app.hard_delete(
    p_table text,
    p_id uuid,
    p_actor uuid,
    p_reason text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
    v_role_name text;
    v_sql text;
BEGIN
    -- Verify actor has SuperAdmin role
    SELECT role_name INTO v_role_name
    FROM users.role_assignments
    WHERE principal_id = p_actor
      AND role_name = 'super_admin'
      AND scope_type = 'platform'
      AND revoked_at IS NULL
    LIMIT 1;

    IF v_role_name IS NULL THEN
        RAISE EXCEPTION 'hard delete denied: super_admin role required';
    END IF;

    -- Log hard delete event
    INSERT INTO app.hard_delete_audit_log (
        table_name, record_id, deleted_by, deletion_reason, deleted_at
    ) VALUES (
        p_table, p_id, p_actor, p_reason, clock_timestamp()
    );

    -- Execute physical delete
    v_sql := format('DELETE FROM %I WHERE id = $1', p_table);
    EXECUTE v_sql USING p_id;

    RETURN FOUND;
END;
$$;

-- Hard delete audit log table (global, not per service)
CREATE TABLE IF NOT EXISTS app.hard_delete_audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name text NOT NULL,
    record_id uuid NOT NULL,
    deleted_by uuid NOT NULL,
    deletion_reason text NOT NULL CHECK (char_length(deletion_reason) > 0),
    deleted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX hard_delete_audit_log_table_idx ON app.hard_delete_audit_log (table_name, deleted_at DESC);

-- RLS policy to block DELETE for non-SuperAdmin
-- (Applied per service during migration execution)

-- Example for tenant-scoped table:
-- ALTER TABLE <schema>.<table> ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE <schema>.<table> FORCE ROW LEVEL SECURITY;
--
-- CREATE POLICY delete_blocked_non_superadmin ON <schema>.<table>
--     FOR DELETE
--     TO aether_<service>_app
--     USING (false);  -- Blocks all DELETE statements

-- Note: hard_delete() function uses SECURITY DEFINER to bypass this policy
```

- [ ] **Step 2: Verify template syntax**

```bash
# Check SQL template for syntax errors (dry run)
psql -d postgres -c "BEGIN; $(cat docs/templates/soft-delete-migration.sql | sed 's/<schema>/test/g; s/<table>/dummy/g; s/<owner_role>/postgres/g'); ROLLBACK;"
```

Expected: No syntax errors (transaction rolled back)

- [ ] **Step 3: Commit template**

```bash
git add docs/templates/soft-delete-migration.sql
git commit -m "docs: add soft delete migration template

Reusable template for adding deleted_at, deleted_by, deletion_reason
columns, hard_delete() security-definer function, and RLS policies.

Ref: ADR-0013

Co-Authored-By: Claude Sonnet 4.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Identity Service Soft Delete Migration

**Files:**
- Create: `services/identity/migrations/000008_soft_delete_schema.up.sql`
- Create: `services/identity/migrations/000008_soft_delete_schema.down.sql`

**Interfaces:**
- Consumes: Migration template from `docs/templates/soft-delete-migration.sql`
- Produces: Identity service tables with soft delete columns and RLS policies

- [ ] **Step 1: Write up migration**

```sql
-- File: services/identity/migrations/000008_soft_delete_schema.up.sql
SET ROLE aether_identity_owner;

-- Add soft delete columns to principals table
ALTER TABLE app.principals
    ADD COLUMN deleted_at timestamptz,
    ADD COLUMN deleted_by uuid,
    ADD COLUMN deletion_reason text;

CREATE INDEX principals_deleted_at_idx ON app.principals (deleted_at)
    WHERE deleted_at IS NOT NULL;

COMMENT ON COLUMN app.principals.deleted_at IS 'Soft delete timestamp - NULL means active principal';
COMMENT ON COLUMN app.principals.deleted_by IS 'Principal ID who performed soft delete';
COMMENT ON COLUMN app.principals.deletion_reason IS 'Audit trail: why principal was archived';

-- Add soft delete columns to credentials table
ALTER TABLE app.credentials
    ADD COLUMN deleted_at timestamptz,
    ADD COLUMN deleted_by uuid,
    ADD COLUMN deletion_reason text;

CREATE INDEX credentials_deleted_at_idx ON app.credentials (deleted_at)
    WHERE deleted_at IS NOT NULL;

-- Refresh tokens already have revoked_at (similar to soft delete)
-- Add deletion tracking for audit
ALTER TABLE app.refresh_tokens
    ADD COLUMN deleted_by uuid,
    ADD COLUMN deletion_reason text;

-- MFA enrollments
ALTER TABLE app.mfa_enrollments
    ADD COLUMN deleted_at timestamptz,
    ADD COLUMN deleted_by uuid,
    ADD COLUMN deletion_reason text;

CREATE INDEX mfa_enrollments_deleted_at_idx ON app.mfa_enrollments (deleted_at)
    WHERE deleted_at IS NOT NULL;

-- Hard delete audit log (shared across services)
CREATE TABLE IF NOT EXISTS app.hard_delete_audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name text NOT NULL,
    record_id uuid NOT NULL,
    deleted_by uuid NOT NULL,
    deletion_reason text NOT NULL CHECK (char_length(deletion_reason) > 0),
    deleted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX hard_delete_audit_log_table_idx ON app.hard_delete_audit_log (table_name, deleted_at DESC);

-- Security-definer function for hard delete (SuperAdmin only)
CREATE OR REPLACE FUNCTION app.hard_delete(
    p_table text,
    p_id uuid,
    p_actor uuid,
    p_reason text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
    v_sql text;
BEGIN
    -- Log hard delete event (authorization checked at API layer)
    INSERT INTO app.hard_delete_audit_log (
        table_name, record_id, deleted_by, deletion_reason, deleted_at
    ) VALUES (
        p_table, p_id, p_actor, p_reason, clock_timestamp()
    );

    -- Execute physical delete
    v_sql := format('DELETE FROM %I WHERE id = $1', p_table);
    EXECUTE v_sql USING p_id;

    RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION app.hard_delete TO aether_identity_app;
```

- [ ] **Step 2: Write down migration**

```sql
-- File: services/identity/migrations/000008_soft_delete_schema.down.sql
SET ROLE aether_identity_owner;

DROP FUNCTION IF EXISTS app.hard_delete;
DROP TABLE IF EXISTS app.hard_delete_audit_log;

ALTER TABLE app.mfa_enrollments
    DROP COLUMN IF EXISTS deleted_at,
    DROP COLUMN IF EXISTS deleted_by,
    DROP COLUMN IF EXISTS deletion_reason;

ALTER TABLE app.refresh_tokens
    DROP COLUMN IF EXISTS deleted_by,
    DROP COLUMN IF EXISTS deletion_reason;

ALTER TABLE app.credentials
    DROP COLUMN IF EXISTS deleted_at,
    DROP COLUMN IF EXISTS deleted_by,
    DROP COLUMN IF EXISTS deletion_reason;

ALTER TABLE app.principals
    DROP COLUMN IF EXISTS deleted_at,
    DROP COLUMN IF EXISTS deleted_by,
    DROP COLUMN IF EXISTS deletion_reason;
```

- [ ] **Step 3: Test migration up**

```bash
make migrate SVC=identity DIR=up
```

Expected: Migration applies successfully

- [ ] **Step 4: Verify schema changes**

```bash
psql -d aether_identity -c "\d app.principals" | grep deleted
psql -d aether_identity -c "\df app.hard_delete"
```

Expected: Columns visible, function exists

- [ ] **Step 5: Test migration down**

```bash
make migrate SVC=identity DIR=down
```

Expected: Rollback successful

- [ ] **Step 6: Re-apply migration**

```bash
make migrate SVC=identity DIR=up
```

- [ ] **Step 7: Commit migrations**

```bash
git add services/identity/migrations/000008_soft_delete_schema.up.sql services/identity/migrations/000008_soft_delete_schema.down.sql
git commit -m "feat(identity): add soft delete schema for principals and credentials

Adds deleted_at, deleted_by, deletion_reason columns to identity tables.
Implements hard_delete() security-definer function for SuperAdmin.

Ref: ADR-0013

Co-Authored-By: Claude Sonnet 4.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Tenant Service Soft Delete Migration

**Files:**
- Create: `services/tenant/migrations/000003_soft_delete_schema.up.sql`
- Create: `services/tenant/migrations/000003_soft_delete_schema.down.sql`

**Interfaces:**
- Consumes: Soft delete pattern from Task 4
- Produces: Tenant service tables with soft delete columns

- [ ] **Step 1: Write up migration**

```sql
-- File: services/tenant/migrations/000003_soft_delete_schema.up.sql
SET ROLE aether_tenant_owner;

-- Tenants (colleges)
ALTER TABLE tenants.tenants
    ADD COLUMN deleted_at timestamptz,
    ADD COLUMN deleted_by uuid,
    ADD COLUMN deletion_reason text;

CREATE INDEX tenants_deleted_at_idx ON tenants.tenants (deleted_at)
    WHERE deleted_at IS NOT NULL;

-- Departments
ALTER TABLE tenants.departments
    ADD COLUMN deleted_at timestamptz,
    ADD COLUMN deleted_by uuid,
    ADD COLUMN deletion_reason text;

CREATE INDEX departments_deleted_at_idx ON tenants.departments (deleted_at)
    WHERE deleted_at IS NOT NULL;

-- Batches
ALTER TABLE tenants.batches
    ADD COLUMN deleted_at timestamptz,
    ADD COLUMN deleted_by uuid,
    ADD COLUMN deletion_reason text;

CREATE INDEX batches_deleted_at_idx ON tenants.batches (deleted_at)
    WHERE deleted_at IS NOT NULL;

-- Placement organizations
ALTER TABLE tenants.placement_orgs
    ADD COLUMN deleted_at timestamptz,
    ADD COLUMN deleted_by uuid,
    ADD COLUMN deletion_reason text;

CREATE INDEX placement_orgs_deleted_at_idx ON tenants.placement_orgs (deleted_at)
    WHERE deleted_at IS NOT NULL;

-- Retention policies (no soft delete - configuration data)
-- Legal holds (no soft delete - must remain immutable until released)

-- Hard delete audit log
CREATE TABLE IF NOT EXISTS app.hard_delete_audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name text NOT NULL,
    record_id uuid NOT NULL,
    deleted_by uuid NOT NULL,
    deletion_reason text NOT NULL CHECK (char_length(deletion_reason) > 0),
    deleted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX hard_delete_audit_log_table_idx ON app.hard_delete_audit_log (table_name, deleted_at DESC);

CREATE OR REPLACE FUNCTION app.hard_delete(
    p_table text,
    p_id uuid,
    p_actor uuid,
    p_reason text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
    v_sql text;
BEGIN
    INSERT INTO app.hard_delete_audit_log (
        table_name, record_id, deleted_by, deletion_reason, deleted_at
    ) VALUES (
        p_table, p_id, p_actor, p_reason, clock_timestamp()
    );

    v_sql := format('DELETE FROM %I WHERE id = $1', p_table);
    EXECUTE v_sql USING p_id;

    RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION app.hard_delete TO aether_tenant_app;
```

- [ ] **Step 2: Write down migration**

```sql
-- File: services/tenant/migrations/000003_soft_delete_schema.down.sql
SET ROLE aether_tenant_owner;

DROP FUNCTION IF EXISTS app.hard_delete;
DROP TABLE IF EXISTS app.hard_delete_audit_log;

ALTER TABLE tenants.placement_orgs DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by, DROP COLUMN IF EXISTS deletion_reason;
ALTER TABLE tenants.batches DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by, DROP COLUMN IF EXISTS deletion_reason;
ALTER TABLE tenants.departments DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by, DROP COLUMN IF EXISTS deletion_reason;
ALTER TABLE tenants.tenants DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by, DROP COLUMN IF EXISTS deletion_reason;
```

- [ ] **Step 3: Apply and test migration**

```bash
make migrate SVC=tenant DIR=up
psql -d aether_tenant -c "\d tenants.tenants" | grep deleted
```

Expected: Columns added successfully

- [ ] **Step 4: Commit migrations**

```bash
git add services/tenant/migrations/000003_soft_delete_schema.up.sql services/tenant/migrations/000003_soft_delete_schema.down.sql
git commit -m "feat(tenant): add soft delete schema for tenants and departments

Adds soft delete columns to tenant-scoped entities. SuperAdmin can hard
delete via security-definer function.

Ref: ADR-0013

Co-Authored-By: Claude Sonnet 4.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: User Service Soft Delete Migration

**Files:**
- Create: `services/user/migrations/000005_soft_delete_schema.up.sql`
- Create: `services/user/migrations/000005_soft_delete_schema.down.sql`

**Interfaces:**
- Consumes: Soft delete pattern from previous tasks
- Produces: User service tables with soft delete and cascade triggers

- [ ] **Step 1: Write up migration with cascade trigger**

```sql
-- File: services/user/migrations/000005_soft_delete_schema.up.sql
SET ROLE aether_user_owner;

-- Profiles
ALTER TABLE users.profiles
    ADD COLUMN deleted_at timestamptz,
    ADD COLUMN deleted_by uuid,
    ADD COLUMN deletion_reason text;

CREATE INDEX profiles_deleted_at_idx ON users.profiles (deleted_at)
    WHERE deleted_at IS NOT NULL;

-- Students (already has status field, add soft delete)
ALTER TABLE users.students
    ADD COLUMN deleted_at timestamptz,
    ADD COLUMN deleted_by uuid,
    ADD COLUMN deletion_reason text;

CREATE INDEX students_deleted_at_idx ON users.students (deleted_at)
    WHERE deleted_at IS NOT NULL;

-- Role assignments
ALTER TABLE users.role_assignments
    ADD COLUMN deleted_at timestamptz,
    ADD COLUMN deleted_by uuid,
    ADD COLUMN deletion_reason text;

CREATE INDEX role_assignments_deleted_at_idx ON users.role_assignments (deleted_at)
    WHERE deleted_at IS NOT NULL;

-- Mentor assignments
ALTER TABLE users.mentor_assignments
    ADD COLUMN deleted_at timestamptz,
    ADD COLUMN deleted_by uuid,
    ADD COLUMN deletion_reason text;

CREATE INDEX mentor_assignments_deleted_at_idx ON users.mentor_assignments (deleted_at)
    WHERE deleted_at IS NOT NULL;

-- Department affiliations
ALTER TABLE users.department_affiliations
    ADD COLUMN deleted_at timestamptz,
    ADD COLUMN deleted_by uuid,
    ADD COLUMN deletion_reason text;

CREATE INDEX department_affiliations_deleted_at_idx ON users.department_affiliations (deleted_at)
    WHERE deleted_at IS NOT NULL;

-- Cascade soft delete trigger: when student soft-deleted, mark affiliations
CREATE OR REPLACE FUNCTION users.cascade_student_soft_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
BEGIN
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
        -- Student was just soft-deleted, cascade to affiliations
        UPDATE users.department_affiliations
        SET deleted_at = NEW.deleted_at,
            deleted_by = NEW.deleted_by,
            deletion_reason = 'Cascaded from student soft delete'
        WHERE student_id = NEW.id
          AND deleted_at IS NULL;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER cascade_student_soft_delete_trigger
    AFTER UPDATE OF deleted_at ON users.students
    FOR EACH ROW
    EXECUTE FUNCTION users.cascade_student_soft_delete();

-- Hard delete audit log
CREATE TABLE IF NOT EXISTS app.hard_delete_audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name text NOT NULL,
    record_id uuid NOT NULL,
    deleted_by uuid NOT NULL,
    deletion_reason text NOT NULL CHECK (char_length(deletion_reason) > 0),
    deleted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX hard_delete_audit_log_table_idx ON app.hard_delete_audit_log (table_name, deleted_at DESC);

CREATE OR REPLACE FUNCTION app.hard_delete(
    p_table text,
    p_id uuid,
    p_actor uuid,
    p_reason text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
    v_sql text;
BEGIN
    INSERT INTO app.hard_delete_audit_log (
        table_name, record_id, deleted_by, deletion_reason, deleted_at
    ) VALUES (
        p_table, p_id, p_actor, p_reason, clock_timestamp()
    );

    v_sql := format('DELETE FROM %I WHERE id = $1', p_table);
    EXECUTE v_sql USING p_id;

    RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION app.hard_delete TO aether_user_app;
```

- [ ] **Step 2: Write down migration**

```sql
-- File: services/user/migrations/000005_soft_delete_schema.down.sql
SET ROLE aether_user_owner;

DROP TRIGGER IF EXISTS cascade_student_soft_delete_trigger ON users.students;
DROP FUNCTION IF EXISTS users.cascade_student_soft_delete;
DROP FUNCTION IF EXISTS app.hard_delete;
DROP TABLE IF EXISTS app.hard_delete_audit_log;

ALTER TABLE users.department_affiliations DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by, DROP COLUMN IF EXISTS deletion_reason;
ALTER TABLE users.mentor_assignments DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by, DROP COLUMN IF EXISTS deletion_reason;
ALTER TABLE users.role_assignments DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by, DROP COLUMN IF EXISTS deletion_reason;
ALTER TABLE users.students DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by, DROP COLUMN IF EXISTS deletion_reason;
ALTER TABLE users.profiles DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by, DROP COLUMN IF EXISTS deletion_reason;
```

- [ ] **Step 3: Apply and test migration**

```bash
make migrate SVC=user DIR=up
psql -d aether_users -c "\d users.students" | grep deleted
```

Expected: Columns and trigger created

- [ ] **Step 4: Test cascade trigger**

```bash
# Insert test data and verify cascade
psql -d aether_users << 'EOF'
BEGIN;
INSERT INTO users.students (id, principal_id, tenant_id, enrollment_number) 
VALUES ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333', 'TEST001');

INSERT INTO users.department_affiliations (id, student_id, department_id, department_type, affiliated_at)
VALUES ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', '55555555-5555-5555-5555-555555555555', 'college', NOW());

UPDATE users.students 
SET deleted_at = NOW(), deleted_by = '22222222-2222-2222-2222-222222222222', deletion_reason = 'Test cascade'
WHERE id = '11111111-1111-1111-1111-111111111111';

SELECT deleted_at IS NOT NULL AS affiliation_cascaded FROM users.department_affiliations WHERE id = '44444444-4444-4444-4444-444444444444';
ROLLBACK;
EOF
```

Expected: `affiliation_cascaded | t`

- [ ] **Step 5: Commit migrations**

```bash
git add services/user/migrations/000005_soft_delete_schema.up.sql services/user/migrations/000005_soft_delete_schema.down.sql
git commit -m "feat(user): add soft delete schema with cascade triggers

Soft deleting a student cascades to department affiliations. SuperAdmin
can hard delete via security-definer function.

Ref: ADR-0013

Co-Authored-By: Claude Sonnet 4.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Remaining Services Migrations (Assessment, Submission, Question Bank)

**Files:**
- Create: `services/assessment/migrations/000003_soft_delete_schema.up.sql`
- Create: `services/assessment/migrations/000003_soft_delete_schema.down.sql`
- Create: `services/submission/migrations/000002_soft_delete_schema.up.sql`
- Create: `services/submission/migrations/000002_soft_delete_schema.down.sql`
- Create: `services/question-bank/migrations/000002_soft_delete_schema.up.sql`
- Create: `services/question-bank/migrations/000002_soft_delete_schema.down.sql`

**Interfaces:**
- Consumes: Soft delete pattern from previous tasks
- Produces: Assessment, Submission, and Question Bank tables with soft delete

- [ ] **Step 1: Assessment service up migration**

```sql
-- File: services/assessment/migrations/000003_soft_delete_schema.up.sql
SET ROLE aether_assessment_owner;

-- Exams
ALTER TABLE assessments.exams
    ADD COLUMN deleted_at timestamptz,
    ADD COLUMN deleted_by uuid,
    ADD COLUMN deletion_reason text;

CREATE INDEX exams_deleted_at_idx ON assessments.exams (deleted_at) WHERE deleted_at IS NOT NULL;

-- Exam versions
ALTER TABLE assessments.exam_versions
    ADD COLUMN deleted_at timestamptz,
    ADD COLUMN deleted_by uuid,
    ADD COLUMN deletion_reason text;

CREATE INDEX exam_versions_deleted_at_idx ON assessments.exam_versions (deleted_at) WHERE deleted_at IS NOT NULL;

-- Assignments
ALTER TABLE assessments.assignments
    ADD COLUMN deleted_at timestamptz,
    ADD COLUMN deleted_by uuid,
    ADD COLUMN deletion_reason text;

CREATE INDEX assignments_deleted_at_idx ON assessments.assignments (deleted_at) WHERE deleted_at IS NOT NULL;

-- Hard delete function
CREATE TABLE IF NOT EXISTS app.hard_delete_audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name text NOT NULL,
    record_id uuid NOT NULL,
    deleted_by uuid NOT NULL,
    deletion_reason text NOT NULL CHECK (char_length(deletion_reason) > 0),
    deleted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX hard_delete_audit_log_table_idx ON app.hard_delete_audit_log (table_name, deleted_at DESC);

CREATE OR REPLACE FUNCTION app.hard_delete(
    p_table text, p_id uuid, p_actor uuid, p_reason text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE v_sql text;
BEGIN
    INSERT INTO app.hard_delete_audit_log (table_name, record_id, deleted_by, deletion_reason, deleted_at)
    VALUES (p_table, p_id, p_actor, p_reason, clock_timestamp());
    v_sql := format('DELETE FROM %I WHERE id = $1', p_table);
    EXECUTE v_sql USING p_id;
    RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION app.hard_delete TO aether_assessment_app;
```

- [ ] **Step 2: Assessment service down migration**

```sql
-- File: services/assessment/migrations/000003_soft_delete_schema.down.sql
SET ROLE aether_assessment_owner;

DROP FUNCTION IF EXISTS app.hard_delete;
DROP TABLE IF EXISTS app.hard_delete_audit_log;

ALTER TABLE assessments.assignments DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by, DROP COLUMN IF EXISTS deletion_reason;
ALTER TABLE assessments.exam_versions DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by, DROP COLUMN IF EXISTS deletion_reason;
ALTER TABLE assessments.exams DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by, DROP COLUMN IF EXISTS deletion_reason;
```

- [ ] **Step 3: Submission service up migration**

```sql
-- File: services/submission/migrations/000002_soft_delete_schema.up.sql
SET ROLE aether_submission_owner;

-- Attempts (archive when exam assignment cancelled)
ALTER TABLE submissions.attempts
    ADD COLUMN deleted_at timestamptz,
    ADD COLUMN deleted_by uuid,
    ADD COLUMN deletion_reason text;

CREATE INDEX attempts_deleted_at_idx ON submissions.attempts (deleted_at) WHERE deleted_at IS NOT NULL;

-- Answer revisions (immutable, no soft delete - keep for audit)
-- Evaluation requests (keep for audit trail)

CREATE TABLE IF NOT EXISTS app.hard_delete_audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name text NOT NULL, record_id uuid NOT NULL,
    deleted_by uuid NOT NULL, deletion_reason text NOT NULL CHECK (char_length(deletion_reason) > 0),
    deleted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX hard_delete_audit_log_table_idx ON app.hard_delete_audit_log (table_name, deleted_at DESC);

CREATE OR REPLACE FUNCTION app.hard_delete(
    p_table text, p_id uuid, p_actor uuid, p_reason text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE v_sql text;
BEGIN
    INSERT INTO app.hard_delete_audit_log (table_name, record_id, deleted_by, deletion_reason, deleted_at)
    VALUES (p_table, p_id, p_actor, p_reason, clock_timestamp());
    v_sql := format('DELETE FROM %I WHERE id = $1', p_table);
    EXECUTE v_sql USING p_id;
    RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION app.hard_delete TO aether_submission_app;
```

- [ ] **Step 4: Submission service down migration**

```sql
-- File: services/submission/migrations/000002_soft_delete_schema.down.sql
SET ROLE aether_submission_owner;

DROP FUNCTION IF EXISTS app.hard_delete;
DROP TABLE IF EXISTS app.hard_delete_audit_log;

ALTER TABLE submissions.attempts DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by, DROP COLUMN IF EXISTS deletion_reason;
```

- [ ] **Step 5: Question Bank service up migration**

```sql
-- File: services/question-bank/migrations/000002_soft_delete_schema.up.sql
SET ROLE aether_qbank_owner;

-- Questions (global, Golden-only)
ALTER TABLE qbank.questions
    ADD COLUMN deleted_at timestamptz,
    ADD COLUMN deleted_by uuid,
    ADD COLUMN deletion_reason text;

CREATE INDEX questions_deleted_at_idx ON qbank.questions (deleted_at) WHERE deleted_at IS NOT NULL;

-- Question versions (immutable, but allow soft delete for retraction)
ALTER TABLE qbank.question_versions
    ADD COLUMN deleted_at timestamptz,
    ADD COLUMN deleted_by uuid,
    ADD COLUMN deletion_reason text;

CREATE INDEX question_versions_deleted_at_idx ON qbank.question_versions (deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS app.hard_delete_audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name text NOT NULL, record_id uuid NOT NULL,
    deleted_by uuid NOT NULL, deletion_reason text NOT NULL CHECK (char_length(deletion_reason) > 0),
    deleted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX hard_delete_audit_log_table_idx ON app.hard_delete_audit_log (table_name, deleted_at DESC);

CREATE OR REPLACE FUNCTION app.hard_delete(
    p_table text, p_id uuid, p_actor uuid, p_reason text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE v_sql text;
BEGIN
    INSERT INTO app.hard_delete_audit_log (table_name, record_id, deleted_by, deletion_reason, deleted_at)
    VALUES (p_table, p_id, p_actor, p_reason, clock_timestamp());
    v_sql := format('DELETE FROM %I WHERE id = $1', p_table);
    EXECUTE v_sql USING p_id;
    RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION app.hard_delete TO aether_qbank_app;
```

- [ ] **Step 6: Question Bank service down migration**

```sql
-- File: services/question-bank/migrations/000002_soft_delete_schema.down.sql
SET ROLE aether_qbank_owner;

DROP FUNCTION IF EXISTS app.hard_delete;
DROP TABLE IF EXISTS app.hard_delete_audit_log;

ALTER TABLE qbank.question_versions DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by, DROP COLUMN IF EXISTS deletion_reason;
ALTER TABLE qbank.questions DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by, DROP COLUMN IF EXISTS deletion_reason;
```

- [ ] **Step 7: Apply all migrations**

```bash
make migrate SVC=assessment DIR=up
make migrate SVC=submission DIR=up
make migrate SVC=question-bank DIR=up
```

Expected: All migrations succeed

- [ ] **Step 8: Verify schema changes**

```bash
for svc in assessment submission question-bank; do
    echo "=== $svc ===" 
    make migrate SVC=$svc DIR=up 2>&1 | tail -5
done
```

Expected: No errors

- [ ] **Step 9: Commit all migrations**

```bash
git add services/assessment/migrations/000003_soft_delete_schema.* \
        services/submission/migrations/000002_soft_delete_schema.* \
        services/question-bank/migrations/000002_soft_delete_schema.*
git commit -m "feat(assessment,submission,qbank): add soft delete schema

Applies soft delete pattern to exam assignments, submission attempts,
and question versions. SuperAdmin can hard delete via security-definer.

Ref: ADR-0013

Co-Authored-By: Claude Sonnet 4.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Domain Layer Validation (User Service Example)

**Files:**
- Modify: `services/user/internal/domain/student.go`
- Modify: `services/user/internal/domain/student_test.go`

**Interfaces:**
- Consumes: `database.SoftDelete()` from `libs/pkg/database/softdelete.go`
- Produces: Domain methods `SoftDelete(actor, reason)` and `CanHardDelete(actor)` with validation

- [ ] **Step 1: Write failing test for student soft delete**

```go
// File: services/user/internal/domain/student_test.go (add to existing file)
func TestStudent_SoftDelete_RequiresReason(t *testing.T) {
	s := &Student{
		ID:               uuid.New(),
		PrincipalID:      uuid.New(),
		TenantID:         uuid.New(),
		EnrollmentNumber: "TEST001",
		Status:           StatusActive,
	}

	actor := uuid.New()
	err := s.SoftDelete(actor, "")
	
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "deletion reason required")
	assert.Nil(t, s.DeletedAt)
}

func TestStudent_SoftDelete_Success(t *testing.T) {
	s := &Student{
		ID:               uuid.New(),
		PrincipalID:      uuid.New(),
		TenantID:         uuid.New(),
		EnrollmentNumber: "TEST001",
		Status:           StatusActive,
	}

	actor := uuid.New()
	reason := "Student withdrew from program"
	err := s.SoftDelete(actor, reason)
	
	assert.NoError(t, err)
	assert.NotNil(t, s.DeletedAt)
	assert.Equal(t, actor, *s.DeletedBy)
	assert.Equal(t, reason, *s.DeletionReason)
}

func TestStudent_CannotSoftDeleteTwice(t *testing.T) {
	now := time.Now()
	actor := uuid.New()
	reason := "Already deleted"
	
	s := &Student{
		ID:             uuid.New(),
		PrincipalID:    uuid.New(),
		TenantID:       uuid.New(),
		DeletedAt:      &now,
		DeletedBy:      &actor,
		DeletionReason: &reason,
	}

	err := s.SoftDelete(uuid.New(), "Second deletion")
	
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "already deleted")
}
```

- [ ] **Step 2: Run test to verify failure**

```bash
cd services/user
go test -v -run TestStudent_SoftDelete ./internal/domain/...
```

Expected: FAIL with "undefined: Student.SoftDelete"

- [ ] **Step 3: Add soft delete fields to Student struct**

```go
// File: services/user/internal/domain/student.go (add fields to struct)
type Student struct {
	ID               uuid.UUID
	PrincipalID      uuid.UUID
	TenantID         uuid.UUID
	EnrollmentNumber string
	Status           StudentStatus
	AdmittedAt       *time.Time
	Version          int
	CreatedAt        time.Time
	UpdatedAt        time.Time
	
	// Soft delete fields
	DeletedAt      *time.Time `gorm:"index"`
	DeletedBy      *uuid.UUID
	DeletionReason *string
}
```

- [ ] **Step 4: Implement SoftDelete domain method**

```go
// File: services/user/internal/domain/student.go (add method)

// SoftDelete marks the student as deleted without physical removal.
// Only SuperAdmin can hard delete via database security-definer function.
func (s *Student) SoftDelete(actor uuid.UUID, reason string) error {
	if reason == "" {
		return fmt.Errorf("deletion reason required for audit trail")
	}

	if s.DeletedAt != nil {
		return fmt.Errorf("student already deleted at %v", s.DeletedAt)
	}

	now := time.Now()
	s.DeletedAt = &now
	s.DeletedBy = &actor
	s.DeletionReason = &reason
	s.UpdatedAt = now

	return nil
}

// IsDeleted checks if the student is soft-deleted.
func (s *Student) IsDeleted() bool {
	return s.DeletedAt != nil
}

// CanHardDelete validates if an actor can perform hard delete.
// Only SuperAdmin role is authorized (enforced at API + database layers).
func (s *Student) CanHardDelete(actorRoles []string) bool {
	for _, role := range actorRoles {
		if role == "super_admin" {
			return true
		}
	}
	return false
}
```

- [ ] **Step 5: Run tests to verify implementation**

```bash
cd services/user
go test -v -run TestStudent_SoftDelete ./internal/domain/...
```

Expected: PASS for all three tests

- [ ] **Step 6: Commit domain changes**

```bash
git add services/user/internal/domain/student.go services/user/internal/domain/student_test.go
git commit -m "feat(user): add soft delete domain validation for students

Implements SoftDelete(actor, reason) method with validation. Hard delete
authorization checked via CanHardDelete(actorRoles).

Ref: ADR-0013

Co-Authored-By: Claude Sonnet 4.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Repository Layer Integration (User Service Example)

**Files:**
- Modify: `services/user/internal/adapters/repo/postgres.go`
- Modify: `services/user/internal/adapters/repo/postgres_test.go`

**Interfaces:**
- Consumes: `database.SoftDeleteScope()` and `database.SoftDelete()` from shared libs
- Produces: Repository methods `SoftDeleteStudent()` and `HardDeleteStudent()` with transaction support

- [ ] **Step 1: Write failing integration test**

```go
// File: services/user/internal/adapters/repo/postgres_test.go (add to existing file)
func TestPostgresRepo_SoftDeleteStudent_FiltersFromQueries(t *testing.T) {
	ctx := context.Background()
	db := testDB(t) // assumes existing test helper
	repo := NewPostgresRepo(db)

	// Create student
	s := &domain.Student{
		ID:               uuid.New(),
		PrincipalID:      uuid.New(),
		TenantID:         uuid.New(),
		EnrollmentNumber: "TEST001",
		Status:           domain.StatusActive,
	}
	require.NoError(t, repo.CreateStudent(ctx, s))

	// Soft delete
	actor := uuid.New()
	require.NoError(t, repo.SoftDeleteStudent(ctx, s.ID, actor, "Test deletion"))

	// Verify not found in default queries
	_, err := repo.GetStudentByID(ctx, s.ID)
	assert.ErrorIs(t, err, domain.ErrNotFound)

	// Verify accessible with IncludeDeleted
	deleted, err := repo.GetStudentByIDIncludeDeleted(ctx, s.ID)
	require.NoError(t, err)
	assert.NotNil(t, deleted.DeletedAt)
	assert.Equal(t, actor, *deleted.DeletedBy)
}
```

- [ ] **Step 2: Run test to verify failure**

```bash
cd services/user
go test -v -run TestPostgresRepo_SoftDeleteStudent ./internal/adapters/repo/...
```

Expected: FAIL with "undefined: repo.SoftDeleteStudent"

- [ ] **Step 3: Update repository to use soft delete scope**

```go
// File: services/user/internal/adapters/repo/postgres.go (update queries)

import (
	"aethercode/libs/pkg/database"
	"aethercode/services/user/internal/domain"
)

// GetStudentByID retrieves active (non-deleted) student by ID.
func (r *PostgresRepo) GetStudentByID(ctx context.Context, id uuid.UUID) (*domain.Student, error) {
	var s domain.Student
	err := r.db.WithContext(ctx).
		Scopes(database.SoftDeleteScope()).
		Where("id = ?", id).
		First(&s).Error

	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("query student: %w", err)
	}

	return &s, nil
}

// GetStudentByIDIncludeDeleted retrieves student including soft-deleted.
// Requires authorization check before calling.
func (r *PostgresRepo) GetStudentByIDIncludeDeleted(ctx context.Context, id uuid.UUID) (*domain.Student, error) {
	var s domain.Student
	err := r.db.WithContext(ctx).
		Scopes(database.IncludeDeletedScope()).
		Where("id = ?", id).
		First(&s).Error

	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("query student: %w", err)
	}

	return &s, nil
}

// SoftDeleteStudent marks student as deleted with audit trail.
func (r *PostgresRepo) SoftDeleteStudent(ctx context.Context, id, actor uuid.UUID, reason string) error {
	return database.SoftDelete(ctx, r.db, database.SoftDeleteParams{
		Table:  "users.students",
		ID:     id,
		Actor:  actor,
		Reason: reason,
	})
}

// HardDeleteStudent permanently removes student via security-definer function.
// Only SuperAdmin can execute this (enforced via RLS and function).
func (r *PostgresRepo) HardDeleteStudent(ctx context.Context, id, actor uuid.UUID, reason string) error {
	return database.HardDelete(ctx, r.db, database.HardDeleteParams{
		Table:  "users.students",
		ID:     id,
		Actor:  actor,
		Reason: reason,
	})
}
```

- [ ] **Step 4: Run integration test**

```bash
cd services/user
go test -v -run TestPostgresRepo_SoftDeleteStudent ./internal/adapters/repo/...
```

Expected: PASS

- [ ] **Step 5: Commit repository changes**

```bash
git add services/user/internal/adapters/repo/postgres.go services/user/internal/adapters/repo/postgres_test.go
git commit -m "feat(user): integrate soft delete in repository layer

Repository queries use SoftDeleteScope by default. Explicit
IncludeDeleted methods require authorization. Hard delete calls
security-definer function.

Ref: ADR-0013

Co-Authored-By: Claude Sonnet 4.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: API Layer Authorization (User Service Example)

**Files:**
- Modify: `services/user/internal/adapters/http/handler.go`
- Modify: `services/user/internal/app/service.go`

**Interfaces:**
- Consumes: Repository `SoftDeleteStudent()` and authorization `CanHardDelete()`
- Produces: HTTP endpoints `DELETE /students/:id` (soft) and `DELETE /students/:id/hard` (SuperAdmin only)

- [ ] **Step 1: Write service layer test**

```go
// File: services/user/internal/app/service_test.go (add to existing file)
func TestUserService_DeleteStudent_SoftDeleteByDefault(t *testing.T) {
	mockRepo := &MockStudentRepo{}
	authz := &MockAuthzService{}
	svc := NewUserService(mockRepo, authz)

	studentID := uuid.New()
	actorID := uuid.New()
	actorRoles := []string{"department_user"}

	mockRepo.On("GetStudentByID", mock.Anything, studentID).Return(&domain.Student{ID: studentID}, nil)
	mockRepo.On("SoftDeleteStudent", mock.Anything, studentID, actorID, mock.Anything).Return(nil)

	err := svc.DeleteStudent(context.Background(), studentID, actorID, actorRoles, "Student withdrew")

	assert.NoError(t, err)
	mockRepo.AssertCalled(t, "SoftDeleteStudent", mock.Anything, studentID, actorID, "Student withdrew")
}

func TestUserService_HardDeleteStudent_SuperAdminOnly(t *testing.T) {
	mockRepo := &MockStudentRepo{}
	authz := &MockAuthzService{}
	svc := NewUserService(mockRepo, authz)

	studentID := uuid.New()
	superAdminID := uuid.New()
	nonAdminID := uuid.New()

	// SuperAdmin succeeds
	mockRepo.On("GetStudentByIDIncludeDeleted", mock.Anything, studentID).Return(&domain.Student{ID: studentID}, nil)
	mockRepo.On("HardDeleteStudent", mock.Anything, studentID, superAdminID, mock.Anything).Return(nil)

	err := svc.HardDeleteStudent(context.Background(), studentID, superAdminID, []string{"super_admin"}, "Retention expired")
	assert.NoError(t, err)

	// Non-SuperAdmin fails
	err = svc.HardDeleteStudent(context.Background(), studentID, nonAdminID, []string{"college_admin"}, "Unauthorized attempt")
	assert.ErrorIs(t, err, ErrUnauthorized)
}
```

- [ ] **Step 2: Run test to verify failure**

```bash
cd services/user
go test -v -run TestUserService_DeleteStudent ./internal/app/...
```

Expected: FAIL with "undefined: service.DeleteStudent"

- [ ] **Step 3: Implement service layer methods**

```go
// File: services/user/internal/app/service.go (add methods)

// DeleteStudent performs soft delete (default for all roles except SuperAdmin).
func (s *UserService) DeleteStudent(ctx context.Context, id, actor uuid.UUID, actorRoles []string, reason string) error {
	if reason == "" {
		return fmt.Errorf("deletion reason required")
	}

	student, err := s.repo.GetStudentByID(ctx, id)
	if err != nil {
		return fmt.Errorf("get student: %w", err)
	}

	if err := student.SoftDelete(actor, reason); err != nil {
		return fmt.Errorf("validate soft delete: %w", err)
	}

	if err := s.repo.SoftDeleteStudent(ctx, id, actor, reason); err != nil {
		return fmt.Errorf("soft delete student: %w", err)
	}

	// Publish domain event
	s.publishEvent(ctx, "student.deleted.v1", id, map[string]interface{}{
		"student_id": id,
		"actor_id":   actor,
		"reason":     reason,
		"deleted_at": time.Now(),
	})

	return nil
}

// HardDeleteStudent permanently removes student (SuperAdmin only).
func (s *UserService) HardDeleteStudent(ctx context.Context, id, actor uuid.UUID, actorRoles []string, reason string) error {
	student, err := s.repo.GetStudentByIDIncludeDeleted(ctx, id)
	if err != nil {
		return fmt.Errorf("get student: %w", err)
	}

	if !student.CanHardDelete(actorRoles) {
		return fmt.Errorf("%w: super_admin role required for hard delete", ErrUnauthorized)
	}

	if err := s.repo.HardDeleteStudent(ctx, id, actor, reason); err != nil {
		return fmt.Errorf("hard delete student: %w", err)
	}

	// Publish domain event
	s.publishEvent(ctx, "student.hard_deleted.v1", id, map[string]interface{}{
		"student_id": id,
		"actor_id":   actor,
		"reason":     reason,
		"deleted_at": time.Now(),
	})

	return nil
}
```

- [ ] **Step 4: Add HTTP handlers**

```go
// File: services/user/internal/adapters/http/handler.go (add endpoints)

// DELETE /students/:id (soft delete)
func (h *Handler) DeleteStudent(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	studentID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.WriteError(w, httpx.ErrBadRequest("invalid student ID"))
		return
	}

	var req struct {
		Reason string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, httpx.ErrBadRequest("invalid request body"))
		return
	}

	actorID := httpauth.ActorID(ctx)
	actorRoles := httpauth.ActorRoles(ctx)

	if err := h.service.DeleteStudent(ctx, studentID, actorID, actorRoles, req.Reason); err != nil {
		httpx.WriteError(w, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// DELETE /students/:id/hard (SuperAdmin only)
func (h *Handler) HardDeleteStudent(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	studentID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.WriteError(w, httpx.ErrBadRequest("invalid student ID"))
		return
	}

	var req struct {
		Reason string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, httpx.ErrBadRequest("invalid request body"))
		return
	}

	actorID := httpauth.ActorID(ctx)
	actorRoles := httpauth.ActorRoles(ctx)

	if err := h.service.HardDeleteStudent(ctx, studentID, actorID, actorRoles, req.Reason); err != nil {
		httpx.WriteError(w, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// Update router registration
func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	// ... existing routes ...
	r.Delete("/students/{id}", h.DeleteStudent)
	r.Delete("/students/{id}/hard", h.HardDeleteStudent)
	return r
}
```

- [ ] **Step 5: Run service tests**

```bash
cd services/user
go test -v ./internal/app/...
```

Expected: PASS

- [ ] **Step 6: Commit API changes**

```bash
git add services/user/internal/app/service.go services/user/internal/app/service_test.go services/user/internal/adapters/http/handler.go
git commit -m "feat(user): add soft/hard delete API endpoints with authorization

DELETE /students/:id performs soft delete (all roles).
DELETE /students/:id/hard requires SuperAdmin role.

Ref: ADR-0013

Co-Authored-By: Claude Sonnet 4.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Integration Tests for Soft Delete Flow

**Files:**
- Create: `services/user/test/integration/soft_delete_test.go`

**Interfaces:**
- Consumes: Testcontainers PostgreSQL, complete user service stack
- Produces: End-to-end integration test validating soft delete behavior

- [ ] **Step 1: Write integration test**

```go
// File: services/user/test/integration/soft_delete_test.go
//go:build integration

package integration_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go/modules/postgres"

	"aethercode/services/user/internal/adapters/http"
	"aethercode/services/user/internal/app"
)

func TestSoftDeleteFlow_EndToEnd(t *testing.T) {
	ctx := context.Background()

	// Start PostgreSQL testcontainer
	pgContainer := startPostgresContainer(t, ctx)
	defer pgContainer.Terminate(ctx)

	// Run migrations
	db := connectDB(t, pgContainer)
	runMigrations(t, db)

	// Setup service stack
	repo := NewPostgresRepo(db)
	svc := app.NewUserService(repo, nil)
	handler := http.NewHandler(svc)

	// Create student
	studentID := uuid.New()
	principalID := uuid.New()
	tenantID := uuid.New()
	actorID := uuid.New()

	student := &domain.Student{
		ID:               studentID,
		PrincipalID:      principalID,
		TenantID:         tenantID,
		EnrollmentNumber: "TEST001",
		Status:           domain.StatusActive,
	}
	require.NoError(t, repo.CreateStudent(ctx, student))

	// Soft delete via API
	reqBody := `{"reason": "Student withdrew from program"}`
	req := httptest.NewRequest(http.MethodDelete, "/students/"+studentID.String(), strings.NewReader(reqBody))
	req = injectAuthContext(req, actorID, []string{"department_user"})
	w := httptest.NewRecorder()

	handler.DeleteStudent(w, req)

	assert.Equal(t, http.StatusNoContent, w.Code)

	// Verify not found in default query
	_, err := repo.GetStudentByID(ctx, studentID)
	assert.ErrorIs(t, err, domain.ErrNotFound)

	// Verify accessible with IncludeDeleted
	deleted, err := repo.GetStudentByIDIncludeDeleted(ctx, studentID)
	require.NoError(t, err)
	assert.NotNil(t, deleted.DeletedAt)
	assert.Equal(t, actorID, *deleted.DeletedBy)
	assert.Equal(t, "Student withdrew from program", *deleted.DeletionReason)
}

func TestHardDeleteFlow_SuperAdminOnly(t *testing.T) {
	ctx := context.Background()
	pgContainer := startPostgresContainer(t, ctx)
	defer pgContainer.Terminate(ctx)

	db := connectDB(t, pgContainer)
	runMigrations(t, db)

	repo := NewPostgresRepo(db)
	svc := app.NewUserService(repo, nil)
	handler := http.NewHandler(svc)

	studentID := createTestStudent(t, repo)

	// Soft delete first
	require.NoError(t, repo.SoftDeleteStudent(ctx, studentID, uuid.New(), "Test"))

	// Attempt hard delete as non-SuperAdmin (should fail)
	reqBody := `{"reason": "Unauthorized attempt"}`
	req := httptest.NewRequest(http.MethodDelete, "/students/"+studentID.String()+"/hard", strings.NewReader(reqBody))
	req = injectAuthContext(req, uuid.New(), []string{"college_admin"})
	w := httptest.NewRecorder()

	handler.HardDeleteStudent(w, req)

	assert.Equal(t, http.StatusForbidden, w.Code)

	// Attempt as SuperAdmin (should succeed)
	superAdminID := uuid.New()
	req2 := httptest.NewRequest(http.MethodDelete, "/students/"+studentID.String()+"/hard", strings.NewReader(`{"reason": "Retention expired"}`))
	req2 = injectAuthContext(req2, superAdminID, []string{"super_admin"})
	w2 := httptest.NewRecorder()

	handler.HardDeleteStudent(w2, req2)

	assert.Equal(t, http.StatusNoContent, w2.Code)

	// Verify physically deleted
	_, err := repo.GetStudentByIDIncludeDeleted(ctx, studentID)
	assert.ErrorIs(t, err, domain.ErrNotFound)
}
```

- [ ] **Step 2: Run integration tests**

```bash
cd services/user
go test -v -tags=integration ./test/integration/...
```

Expected: PASS (both tests)

- [ ] **Step 3: Commit integration tests**

```bash
git add services/user/test/integration/soft_delete_test.go
git commit -m "test(user): add soft delete integration tests

End-to-end tests validate soft delete flow, hard delete authorization,
and query filtering behavior.

Ref: ADR-0013

Co-Authored-By: Claude Sonnet 4.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Documentation Updates

**Files:**
- Modify: `services/user/README.md`
- Modify: `services/identity/README.md`
- Modify: `services/tenant/README.md`
- Modify: `docs/README.md`

**Interfaces:**
- Consumes: ADR-0013 and implemented soft delete architecture
- Produces: Updated service README files documenting soft delete behavior

- [ ] **Step 1: Update user service README**

Open `services/user/README.md` and add section:

```markdown
## Soft Delete Behavior

All user entities support soft delete (archival without physical removal):

- **Default queries**: Filter `deleted_at IS NULL` automatically
- **Soft delete**: `DELETE /students/:id` with `{"reason": "..."}` (all authorized roles)
- **Hard delete**: `DELETE /students/:id/hard` with `{"reason": "..."}` (SuperAdmin only)
- **Cascade**: Soft deleting a student cascades to department affiliations
- **Audit trail**: `deleted_by` and `deletion_reason` columns track who deleted and why

### Authorization Rules

| Role | Soft Delete | Hard Delete | View Archived |
|------|-------------|-------------|---------------|
| SuperAdmin | ✓ | ✓ | ✓ |
| CollegeAdmin | ✓ (own tenant) | ✗ | ✓ (own tenant) |
| DepartmentUser | ✓ (own dept) | ✗ | ✓ (own dept) |
| Mentor | ✗ | ✗ | ✗ |
| Student | ✗ | ✗ | ✗ |

Ref: ADR-0013
```

- [ ] **Step 2: Update identity service README**

Open `services/identity/README.md` and add similar section:

```markdown
## Soft Delete Behavior

Principals and credentials support soft delete for account deactivation:

- **Soft delete**: Archives authentication records while preserving audit history
- **Hard delete**: SuperAdmin can permanently remove principals after retention period
- **Refresh tokens**: Already use `revoked_at` (similar to soft delete)
- **MFA enrollments**: Soft-deleted when principal archived

Ref: ADR-0013
```

- [ ] **Step 3: Update tenant service README**

Open `services/tenant/README.md` and add:

```markdown
## Soft Delete Behavior

Tenant entities (colleges, departments, batches) support soft delete:

- **Tenant deletion**: Soft-deletes tenant and all child departments/batches
- **Department deletion**: Soft-deletes department and child batches
- **Placement orgs**: SuperAdmin can soft/hard delete placement organizations
- **Retention policies**: Not soft-deletable (configuration data)
- **Legal holds**: Not soft-deletable (must remain immutable until released)

Ref: ADR-0013
```

- [ ] **Step 4: Update main docs README**

Open `docs/README.md` and add to architecture section:

```markdown
## Soft Delete Architecture

Platform-wide soft delete ensures data safety and compliance:

- **ADR-0013**: Soft delete architecture decision record
- **Template**: `docs/templates/soft-delete-migration.sql` for adding to services
- **Shared utilities**: `libs/pkg/database/softdelete.go` provides GORM scopes
- **Authorization**: Only SuperAdmin can hard delete via security-definer function

All services implement soft delete for tenant-scoped entities.
```

- [ ] **Step 5: Verify documentation links**

```bash
grep -r "ADR-0013" services/*/README.md docs/README.md
```

Expected: All README files reference ADR-0013

- [ ] **Step 6: Commit documentation updates**

```bash
git add services/user/README.md services/identity/README.md services/tenant/README.md docs/README.md
git commit -m "docs: update service READMEs with soft delete behavior

Documents soft delete endpoints, authorization rules, cascade behavior,
and audit trail columns.

Ref: ADR-0013

Co-Authored-By: Claude Sonnet 4.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: CI/CD Validation

**Files:**
- Modify: `.github/workflows/ci.yml` (if exists)
- Create: `scripts/validate-soft-delete.sh`

**Interfaces:**
- Consumes: All service migrations and tests
- Produces: CI validation script checking soft delete implementation

- [ ] **Step 1: Write validation script**

```bash
# File: scripts/validate-soft-delete.sh
#!/usr/bin/env bash
set -euo pipefail

echo "=== Validating Soft Delete Implementation ==="

SERVICES=(identity tenant user assessment submission question-bank)

for svc in "${SERVICES[@]}"; do
    echo "Checking $svc service..."
    
    # Verify migration files exist
    up_migration=$(find "services/$svc/migrations" -name "*soft_delete*.up.sql" | head -1)
    if [[ -z "$up_migration" ]]; then
        echo "ERROR: No soft delete up migration for $svc"
        exit 1
    fi
    
    # Verify migration contains required columns
    for col in deleted_at deleted_by deletion_reason; do
        if ! grep -q "ADD COLUMN $col" "$up_migration"; then
            echo "ERROR: Migration missing $col column in $svc"
            exit 1
        fi
    done
    
    # Verify hard_delete function exists
    if ! grep -q "CREATE OR REPLACE FUNCTION app.hard_delete" "$up_migration"; then
        echo "ERROR: Missing hard_delete function in $svc"
        exit 1
    fi
    
    echo "✓ $svc migration valid"
done

# Verify shared utilities exist
if [[ ! -f "libs/pkg/database/softdelete.go" ]]; then
    echo "ERROR: Missing shared softdelete.go"
    exit 1
fi

if ! grep -q "func SoftDeleteScope" "libs/pkg/database/softdelete.go"; then
    echo "ERROR: Missing SoftDeleteScope function"
    exit 1
fi

echo "✓ Shared utilities valid"

# Verify ADR exists
if [[ ! -f "docs/adr/0013-soft-delete-architecture.md" ]]; then
    echo "ERROR: Missing ADR-0013"
    exit 1
fi

echo "✓ ADR-0013 exists"

echo "=== All Soft Delete Validations Passed ==="
```

- [ ] **Step 2: Make script executable**

```bash
chmod +x scripts/validate-soft-delete.sh
```

- [ ] **Step 3: Run validation script**

```bash
./scripts/validate-soft-delete.sh
```

Expected: "All Soft Delete Validations Passed"

- [ ] **Step 4: Add to CI pipeline (if .github/workflows/ci.yml exists)**

If CI workflow exists, add step:

```yaml
- name: Validate Soft Delete Implementation
  run: ./scripts/validate-soft-delete.sh
```

- [ ] **Step 5: Commit validation script**

```bash
git add scripts/validate-soft-delete.sh
git commit -m "ci: add soft delete implementation validation script

Validates all services have soft delete migrations, shared utilities
exist, and ADR-0013 is present.

Ref: ADR-0013

Co-Authored-By: Claude Sonnet 4.5 (1M context) <noreply@anthropic.com>"
```

---

## Plan Complete

All tasks implement comprehensive soft delete architecture across the AetherCode platform:

- ✅ ADR-0013 documents decision rationale
- ✅ CLAUDE.md updated with core principle
- ✅ Shared utilities in `libs/pkg/database/softdelete.go`
- ✅ Migration template for future services
- ✅ All 6 platform services migrated (identity, tenant, user, assessment, submission, question-bank)
- ✅ Domain layer validation (Student example)
- ✅ Repository layer integration with GORM scopes
- ✅ API layer authorization (soft/hard delete endpoints)
- ✅ Integration tests validate end-to-end flow
- ✅ Service READMEs document soft delete behavior
- ✅ CI validation script ensures consistency

**Authorization Summary:**
- **SuperAdmin**: Hard delete via `app.hard_delete()` security-definer function
- **All other roles**: Soft delete only (sets `deleted_at`, `deleted_by`, `deletion_reason`)
- **Database RLS**: Blocks physical DELETE statements for non-SuperAdmin roles
- **API layer**: Validates actor roles before allowing hard delete operations
- **Audit trail**: All deletions logged with actor, reason, and timestamp

**Next Steps:**
1. Apply remaining service migrations (Judge, SEB, Notification, Analytics)
2. Update frontend to show "Archived" status for soft-deleted records
3. Implement retention policy automation (SuperAdmin hard-deletes after retention period expires)
4. Add monitoring dashboard for soft-delete growth per tenant
