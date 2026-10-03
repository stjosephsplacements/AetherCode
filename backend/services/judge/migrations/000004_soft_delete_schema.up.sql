-- File: services/judge/migrations/000004_soft_delete_schema.up.sql
-- Soft delete support for Judge service control plane
--
-- Tables requiring soft delete:
-- - execution_jobs: main execution records (tenant-scoped via fairness_key)
-- - language_mappings: configuration data
--
-- Tables excluded (immutable audit/event logs):
-- - execution_events: append-only event log
-- - inbox_messages: idempotency tracking
-- - dispatch_attempts: operational audit trail
--
-- Tables with CASCADE references will be cleaned up automatically when
-- parent records are hard-deleted by SuperAdmin.

SET ROLE aether_judge_migrator;

-- The Judge control plane bootstrap creates only the judge schema; unlike the
-- platform databases it has no app schema. The hard-delete audit objects below
-- live in app, so create it here where it is first required.
CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION aether_judge_migrator;
GRANT USAGE ON SCHEMA app TO aether_judge_app;

-- Add soft delete columns to execution_jobs
ALTER TABLE judge.execution_jobs
    ADD COLUMN deleted_at timestamptz,
    ADD COLUMN deleted_by uuid,
    ADD COLUMN deletion_reason text;

CREATE INDEX execution_jobs_deleted_at_idx ON judge.execution_jobs (deleted_at)
    WHERE deleted_at IS NOT NULL;

COMMENT ON COLUMN judge.execution_jobs.deleted_at IS 'Soft delete timestamp - NULL means active job';
COMMENT ON COLUMN judge.execution_jobs.deleted_by IS 'Principal ID who performed soft delete';
COMMENT ON COLUMN judge.execution_jobs.deletion_reason IS 'Audit trail: why job was archived';

-- Add soft delete columns to language_mappings
ALTER TABLE judge.language_mappings
    ADD COLUMN deleted_at timestamptz,
    ADD COLUMN deleted_by uuid,
    ADD COLUMN deletion_reason text;

CREATE INDEX language_mappings_deleted_at_idx ON judge.language_mappings (deleted_at)
    WHERE deleted_at IS NOT NULL;

COMMENT ON COLUMN judge.language_mappings.deleted_at IS 'Soft delete timestamp - NULL means active mapping';
COMMENT ON COLUMN judge.language_mappings.deleted_by IS 'Principal ID who performed soft delete';
COMMENT ON COLUMN judge.language_mappings.deletion_reason IS 'Audit trail: why mapping was archived';

-- Hard delete audit log (shared across services, idempotent creation)
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

COMMENT ON TABLE app.hard_delete_audit_log IS 'Audit log for hard deletes performed by SuperAdmin';
COMMENT ON COLUMN app.hard_delete_audit_log.table_name IS 'Schema-qualified table name';
COMMENT ON COLUMN app.hard_delete_audit_log.record_id IS 'Primary key of deleted record';
COMMENT ON COLUMN app.hard_delete_audit_log.deleted_by IS 'Principal ID who performed hard delete';
COMMENT ON COLUMN app.hard_delete_audit_log.deletion_reason IS 'Required justification for hard delete';

-- Security-definer function for hard delete (SuperAdmin only)
-- Authorization: app-layer Casbin check + GRANT EXECUTE restriction
CREATE OR REPLACE FUNCTION app.hard_delete(
    p_table text,
    p_id uuid,
    p_actor uuid,
    p_reason text
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
    INSERT INTO app.hard_delete_audit_log (
        table_name, record_id, deleted_by, deletion_reason, deleted_at
    ) VALUES (
        p_table, p_id, p_actor, p_reason, clock_timestamp()
    );

    -- Execute physical delete with properly quoted schema.table
    v_sql := format('DELETE FROM %I.%I WHERE id = $1', v_schema, v_table);
    EXECUTE v_sql USING p_id;

    RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION app.hard_delete TO aether_judge_app;

RESET ROLE;
