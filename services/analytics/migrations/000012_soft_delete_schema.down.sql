-- File: services/analytics/migrations/000012_soft_delete_schema.down.sql
SET ROLE aether_analytics_owner;

-- Restore original RLS policies
DROP POLICY IF EXISTS analytics_report_exports_signed_read ON analytics.report_exports;
CREATE POLICY analytics_report_exports_signed_read
    ON analytics.report_exports
    FOR SELECT
    TO aether_analytics_app
    USING (
        authz.current_context_allows_read(
            tenant_id,
            'analytics.read',
            'analytics.write',
            'analytics.report_exports'
        )
    );

DROP POLICY IF EXISTS analytics_report_exports_owner_maintenance ON analytics.report_exports;
CREATE POLICY analytics_report_exports_owner_maintenance
    ON analytics.report_exports
    FOR ALL
    TO aether_analytics_owner
    USING (true)
    WITH CHECK (true);

-- Remove soft delete columns from report_exports
DROP INDEX IF EXISTS analytics.report_exports_deleted_at_idx;

ALTER TABLE analytics.report_exports
    DROP COLUMN IF EXISTS deletion_reason,
    DROP COLUMN IF EXISTS deleted_by,
    DROP COLUMN IF EXISTS deleted_at;

-- Note: We don't drop app.hard_delete_audit_log or app.hard_delete function
-- as they might be shared with other services

REVOKE EXECUTE ON FUNCTION app.hard_delete FROM aether_analytics_app;

RESET ROLE;
