SET ROLE aether_seb_owner;

-- Add soft delete columns to configurations
ALTER TABLE seb.configurations
    ADD COLUMN deleted_at timestamptz,
    ADD COLUMN deleted_by uuid,
    ADD COLUMN deletion_reason text;

CREATE INDEX configurations_deleted_at_idx ON seb.configurations (deleted_at)
    WHERE deleted_at IS NOT NULL;

-- Add soft delete columns to sessions
ALTER TABLE seb.sessions
    ADD COLUMN deleted_at timestamptz,
    ADD COLUMN deleted_by uuid,
    ADD COLUMN deletion_reason text;

CREATE INDEX sessions_deleted_at_idx ON seb.sessions (deleted_at)
    WHERE deleted_at IS NOT NULL;

-- Cascade soft delete: when configuration soft-deleted, mark related sessions
CREATE OR REPLACE FUNCTION seb.cascade_configuration_soft_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
BEGIN
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
        -- Configuration was just soft-deleted, cascade to sessions
        UPDATE seb.sessions
        SET deleted_at = NEW.deleted_at,
            deleted_by = NEW.deleted_by,
            deletion_reason = 'Cascaded from configuration soft delete'
        WHERE configuration_id = NEW.id
          AND deleted_at IS NULL;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER cascade_configuration_soft_delete_trigger
    AFTER UPDATE OF deleted_at ON seb.configurations
    FOR EACH ROW
    EXECUTE FUNCTION seb.cascade_configuration_soft_delete();

-- Hard delete audit log (create if not exists, shared across services)
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

-- Hard delete function (create if not exists, shared across services)
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

GRANT EXECUTE ON FUNCTION app.hard_delete TO aether_seb_app;

-- Update RLS policies to exclude soft-deleted records by default
-- Drop existing policies first
DROP POLICY IF EXISTS seb_configurations_signed_read ON seb.configurations;
DROP POLICY IF EXISTS seb_sessions_signed_read ON seb.sessions;

-- Recreate read policies with soft delete filter
CREATE POLICY seb_configurations_signed_read ON seb.configurations
    FOR SELECT TO aether_seb_app
    USING (
        authz.current_context_allows_read(tenant_id, 'seb.read', 'seb.write', 'seb.configurations')
        AND deleted_at IS NULL
    );

CREATE POLICY seb_sessions_signed_read ON seb.sessions
    FOR SELECT TO aether_seb_app
    USING (
        authz.current_context_allows_read(tenant_id, 'seb.read', 'seb.write', 'seb.sessions')
        AND deleted_at IS NULL
    );

-- Update policies to prevent updates/deletes of soft-deleted records
DROP POLICY IF EXISTS seb_configurations_signed_update ON seb.configurations;
DROP POLICY IF EXISTS seb_configurations_signed_delete ON seb.configurations;
DROP POLICY IF EXISTS seb_sessions_signed_update ON seb.sessions;
DROP POLICY IF EXISTS seb_sessions_signed_delete ON seb.sessions;

-- Recreate update/delete policies with soft delete filter
CREATE POLICY seb_configurations_signed_update ON seb.configurations
    FOR UPDATE TO aether_seb_app
    USING (
        authz.current_context_allows(tenant_id, 'seb.write', 'seb.configurations')
        AND deleted_at IS NULL
    )
    WITH CHECK (
        authz.current_context_allows(tenant_id, 'seb.write', 'seb.configurations')
    );

CREATE POLICY seb_configurations_signed_delete ON seb.configurations
    FOR DELETE TO aether_seb_app
    USING (
        authz.current_context_allows(tenant_id, 'seb.write', 'seb.configurations')
        AND deleted_at IS NULL
    );

CREATE POLICY seb_sessions_signed_update ON seb.sessions
    FOR UPDATE TO aether_seb_app
    USING (
        authz.current_context_allows(tenant_id, 'seb.write', 'seb.sessions')
        AND deleted_at IS NULL
    )
    WITH CHECK (
        authz.current_context_allows(tenant_id, 'seb.write', 'seb.sessions')
    );

CREATE POLICY seb_sessions_signed_delete ON seb.sessions
    FOR DELETE TO aether_seb_app
    USING (
        authz.current_context_allows(tenant_id, 'seb.write', 'seb.sessions')
        AND deleted_at IS NULL
    );

RESET ROLE;
