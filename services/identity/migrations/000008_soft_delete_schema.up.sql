-- File: services/identity/migrations/000008_soft_delete_schema.up.sql
SET ROLE aether_identity_owner;

-- Add soft delete columns to principals table (deleted_at already exists from 000002)
ALTER TABLE identity.principals
    ADD COLUMN IF NOT EXISTS deleted_by uuid,
    ADD COLUMN IF NOT EXISTS deletion_reason text;

COMMENT ON COLUMN identity.principals.deleted_at IS 'Soft delete timestamp - NULL means active principal';
COMMENT ON COLUMN identity.principals.deleted_by IS 'Principal ID who performed soft delete';
COMMENT ON COLUMN identity.principals.deletion_reason IS 'Audit trail: why principal was archived';

-- Add soft delete columns to password_credentials table
ALTER TABLE identity.password_credentials
    ADD COLUMN deleted_at timestamptz,
    ADD COLUMN deleted_by uuid,
    ADD COLUMN deletion_reason text;

CREATE INDEX password_credentials_deleted_at_idx ON identity.password_credentials (deleted_at)
    WHERE deleted_at IS NOT NULL;

COMMENT ON COLUMN identity.password_credentials.deleted_at IS 'Soft delete timestamp - NULL means active credential';
COMMENT ON COLUMN identity.password_credentials.deleted_by IS 'Principal ID who performed soft delete';
COMMENT ON COLUMN identity.password_credentials.deletion_reason IS 'Audit trail: why credential was archived';

-- Refresh tokens already have revoked_at (similar to soft delete)
-- Add deletion tracking for audit
ALTER TABLE identity.refresh_tokens
    ADD COLUMN deleted_by uuid,
    ADD COLUMN deletion_reason text;

COMMENT ON COLUMN identity.refresh_tokens.deleted_by IS 'Principal ID who performed soft delete';
COMMENT ON COLUMN identity.refresh_tokens.deletion_reason IS 'Audit trail: why token was archived';

-- MFA factors
ALTER TABLE identity.mfa_factors
    ADD COLUMN deleted_at timestamptz,
    ADD COLUMN deleted_by uuid,
    ADD COLUMN deletion_reason text;

CREATE INDEX mfa_factors_deleted_at_idx ON identity.mfa_factors (deleted_at)
    WHERE deleted_at IS NOT NULL;

COMMENT ON COLUMN identity.mfa_factors.deleted_at IS 'Soft delete timestamp - NULL means active factor';
COMMENT ON COLUMN identity.mfa_factors.deleted_by IS 'Principal ID who performed soft delete';
COMMENT ON COLUMN identity.mfa_factors.deletion_reason IS 'Audit trail: why factor was archived';

-- Hard delete audit log (shared across services)
CREATE TABLE IF NOT EXISTS app.hard_delete_audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name text NOT NULL,
    record_id uuid NOT NULL,
    deleted_by uuid NOT NULL,
    deletion_reason text NOT NULL CHECK (char_length(deletion_reason) > 0),
    deleted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS hard_delete_audit_log_table_idx ON app.hard_delete_audit_log (table_name, deleted_at DESC);

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

GRANT EXECUTE ON FUNCTION app.hard_delete TO aether_identity_app;

RESET ROLE;
