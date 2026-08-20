-- Rollback: remove restrictive block_delete and restore original signed_delete policy from 000002.

SET ROLE aether_analytics_owner;

DROP POLICY IF EXISTS block_delete ON analytics.report_exports;

-- Restore original signed_delete policy (created by DO loop in 000002_domain.up.sql)
CREATE POLICY analytics_report_exports_signed_delete ON analytics.report_exports
    FOR DELETE TO aether_analytics_app
    USING (authz.current_context_allows(tenant_id, 'analytics.write', 'analytics.report_exports'));

RESET ROLE;
