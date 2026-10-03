-- Rollback: remove restrictive block_delete and restore original signed_delete policies from 000002.

SET ROLE aether_seb_owner;

DROP POLICY IF EXISTS block_delete ON seb.configurations;
DROP POLICY IF EXISTS block_delete ON seb.sessions;

-- Restore original signed_delete policies (created by DO loop in 000002_domain.up.sql)
CREATE POLICY seb_configurations_signed_delete ON seb.configurations
    FOR DELETE TO aether_seb_app
    USING (authz.current_context_allows(tenant_id, 'seb.write', 'seb.configurations'));

CREATE POLICY seb_sessions_signed_delete ON seb.sessions
    FOR DELETE TO aether_seb_app
    USING (authz.current_context_allows(tenant_id, 'seb.write', 'seb.sessions'));

RESET ROLE;
