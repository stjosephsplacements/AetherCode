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
-- AUTHORIZATION: Defense-in-depth using PostgreSQL role membership check
-- API layer verifies actor has 'super_admin' role; database layer enforces via pg_has_role()
-- This avoids cross-schema dependencies while maintaining security controls
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
    -- Defense-in-depth: verify actor has super_admin_role at DB layer
    -- Uses PostgreSQL role membership, no cross-schema dependency
    IF NOT pg_has_role(p_actor::text, 'super_admin_role', 'MEMBER') THEN
        RAISE EXCEPTION 'hard delete denied: super_admin role required for actor %', p_actor;
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
-- Authorization for hard delete enforces defense-in-depth:
--   1. API middleware verifies actor has 'super_admin' role via User service
--   2. Only after authorization passes is app.hard_delete() invoked
--   3. Database function verifies actor has super_admin_role via pg_has_role()
--   4. After DB-level authorization, function logs and executes delete
-- This pattern maintains microservice isolation while providing layered security
--
-- OPERATIONAL REQUIREMENT:
--   PostgreSQL role 'super_admin_role' must exist and SuperAdmin users must be
--   granted membership via GRANT super_admin_role TO <principal_role>
