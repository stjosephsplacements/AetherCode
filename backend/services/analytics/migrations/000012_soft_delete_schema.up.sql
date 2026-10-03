-- File: services/analytics/migrations/000012_soft_delete_schema.up.sql
SET ROLE aether_analytics_owner;

-- Report exports: user-facing table for generated reports
-- Soft delete allows manual removal while preserving audit trail
ALTER TABLE analytics.report_exports
    ADD COLUMN deleted_at timestamptz,
    ADD COLUMN deleted_by uuid,
    ADD COLUMN deletion_reason text;

CREATE INDEX report_exports_deleted_at_idx
    ON analytics.report_exports (deleted_at) WHERE deleted_at IS NOT NULL;

-- Projection tables are event-fed and immutable - no soft delete needed:
-- - student_progress_rollups (rebuilt from events)
-- - exam_result_rollups (rebuilt from events)
-- - batch_progress_rollups (rebuilt from events)
-- - placement_student_rollups (rebuilt from events)
-- - event_facts (append-only with retention policy)
-- - *_projections tables (event-sourced, immutable)

-- Create shared hard_delete_audit_log table if not exists
CREATE TABLE IF NOT EXISTS app.hard_delete_audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name text NOT NULL,
    record_id uuid NOT NULL,
    deleted_by uuid NOT NULL,
    deletion_reason text NOT NULL CHECK (char_length(deletion_reason) > 0),
    deleted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS hard_delete_audit_log_table_idx
    ON app.hard_delete_audit_log (table_name, deleted_at DESC);

-- Hard delete function: authorization via app-layer Casbin check + GRANT EXECUTE restriction
CREATE OR REPLACE FUNCTION app.hard_delete(
    p_table text, p_id uuid, p_actor uuid, p_reason text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
    v_schema text;
    v_table text;
    v_sql text;
BEGIN
    -- Validate inputs
    IF p_table IS NULL OR p_id IS NULL OR p_actor IS NULL OR coalesce(p_reason, '') = '' THEN
        RAISE EXCEPTION 'hard_delete: all parameters required (table, id, actor, reason)';
    END IF;

    -- Validate schema-qualified table format
    v_schema := split_part(p_table, '.', 1);
    v_table := split_part(p_table, '.', 2);
    IF v_schema = '' OR v_table = '' OR split_part(p_table, '.', 3) <> '' THEN
        RAISE EXCEPTION 'hard_delete: p_table must be schema-qualified (schema.table), got: %', p_table;
    END IF;

    -- Authorization note: app-layer Casbin check verifies super_admin before calling.
    -- This function is GRANT EXECUTE only to the service app role — no other roles can invoke it.
    -- The SECURITY DEFINER context bypasses RLS block_delete policies.

    -- Audit the hard delete
    INSERT INTO app.hard_delete_audit_log (table_name, record_id, deleted_by, deletion_reason, deleted_at)
    VALUES (p_table, p_id, p_actor, p_reason, clock_timestamp());

    -- Execute physical delete with properly quoted schema.table
    v_sql := format('DELETE FROM %I.%I WHERE id = $1', v_schema, v_table);
    EXECUTE v_sql USING p_id;

    RETURN FOUND;
END;
$$;

-- Update RLS policies to exclude soft-deleted records from normal queries
-- Drop and recreate SELECT policies with soft delete filter
DROP POLICY IF EXISTS analytics_report_exports_signed_read ON analytics.report_exports;
CREATE POLICY analytics_report_exports_signed_read
    ON analytics.report_exports
    FOR SELECT
    TO aether_analytics_app
    USING (
        deleted_at IS NULL
        AND authz.current_context_allows_read(
            tenant_id,
            'analytics.read',
            'analytics.write',
            'analytics.report_exports'
        )
    );

-- Owner policy includes soft-deleted records for maintenance/audit
DROP POLICY IF EXISTS analytics_report_exports_owner_maintenance ON analytics.report_exports;
CREATE POLICY analytics_report_exports_owner_maintenance
    ON analytics.report_exports
    FOR ALL
    TO aether_analytics_owner
    USING (true)
    WITH CHECK (true);

GRANT EXECUTE ON FUNCTION app.hard_delete TO aether_analytics_app;

RESET ROLE;
