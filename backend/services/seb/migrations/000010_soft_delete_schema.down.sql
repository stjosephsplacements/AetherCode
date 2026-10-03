SET ROLE aether_seb_owner;

-- Drop cascade trigger and function
DROP TRIGGER IF EXISTS cascade_configuration_soft_delete_trigger ON seb.configurations;
DROP FUNCTION IF EXISTS seb.cascade_configuration_soft_delete;

-- Drop function and audit log (only if not used by other services)
-- Note: These are shared across services, so dropping should be done carefully
-- Typically keep them if other services use them
DROP FUNCTION IF EXISTS app.hard_delete;
DROP TABLE IF EXISTS app.hard_delete_audit_log;

-- Restore original RLS policies
DROP POLICY IF EXISTS seb_configurations_signed_read ON seb.configurations;
DROP POLICY IF EXISTS seb_configurations_signed_update ON seb.configurations;
DROP POLICY IF EXISTS seb_configurations_signed_delete ON seb.configurations;
DROP POLICY IF EXISTS seb_sessions_signed_read ON seb.sessions;
DROP POLICY IF EXISTS seb_sessions_signed_update ON seb.sessions;
DROP POLICY IF EXISTS seb_sessions_signed_delete ON seb.sessions;

-- Recreate original policies without soft delete filter
CREATE POLICY seb_configurations_signed_read ON seb.configurations
    FOR SELECT TO aether_seb_app
    USING (authz.current_context_allows_read(tenant_id, 'seb.read', 'seb.write', 'seb.configurations'));

CREATE POLICY seb_configurations_signed_update ON seb.configurations
    FOR UPDATE TO aether_seb_app
    USING (authz.current_context_allows(tenant_id, 'seb.write', 'seb.configurations'))
    WITH CHECK (authz.current_context_allows(tenant_id, 'seb.write', 'seb.configurations'));

CREATE POLICY seb_configurations_signed_delete ON seb.configurations
    FOR DELETE TO aether_seb_app
    USING (authz.current_context_allows(tenant_id, 'seb.write', 'seb.configurations'));

CREATE POLICY seb_sessions_signed_read ON seb.sessions
    FOR SELECT TO aether_seb_app
    USING (authz.current_context_allows_read(tenant_id, 'seb.read', 'seb.write', 'seb.sessions'));

CREATE POLICY seb_sessions_signed_update ON seb.sessions
    FOR UPDATE TO aether_seb_app
    USING (authz.current_context_allows(tenant_id, 'seb.write', 'seb.sessions'))
    WITH CHECK (authz.current_context_allows(tenant_id, 'seb.write', 'seb.sessions'));

CREATE POLICY seb_sessions_signed_delete ON seb.sessions
    FOR DELETE TO aether_seb_app
    USING (authz.current_context_allows(tenant_id, 'seb.write', 'seb.sessions'));

-- Drop soft delete columns
DROP INDEX IF EXISTS sessions_deleted_at_idx;
ALTER TABLE seb.sessions
    DROP COLUMN IF EXISTS deleted_at,
    DROP COLUMN IF EXISTS deleted_by,
    DROP COLUMN IF EXISTS deletion_reason;

DROP INDEX IF EXISTS configurations_deleted_at_idx;
ALTER TABLE seb.configurations
    DROP COLUMN IF EXISTS deleted_at,
    DROP COLUMN IF EXISTS deleted_by,
    DROP COLUMN IF EXISTS deletion_reason;

RESET ROLE;
