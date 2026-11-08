SET ROLE aether_analytics_owner;

REVOKE EXECUTE ON FUNCTION authz.current_context_covers_node(uuid)
    FROM aether_analytics_app;

DROP POLICY IF EXISTS analytics_student_batch_affiliation_app_read
    ON analytics.student_batch_affiliation_projections;

REVOKE SELECT ON TABLE analytics.student_batch_affiliation_projections
    FROM aether_analytics_app;

DROP POLICY IF EXISTS analytics_placement_student_rollups_app_read
    ON analytics.placement_student_rollups;

-- Restore original tenant-level read policy for placement_student_rollups.
CREATE POLICY analytics_placement_student_rollups_signed_read
    ON analytics.placement_student_rollups
    FOR SELECT TO aether_analytics_app
    USING (authz.current_context_allows_read(tenant_id, 'analytics.read', 'analytics.write', 'analytics.placement_student_rollups'));

DROP POLICY IF EXISTS analytics_batch_progress_rollups_app_read
    ON analytics.batch_progress_rollups;

-- Restore original tenant-level read policy for batch_progress_rollups.
CREATE POLICY analytics_batch_progress_rollups_signed_read
    ON analytics.batch_progress_rollups
    FOR SELECT TO aether_analytics_app
    USING (authz.current_context_allows_read(tenant_id, 'analytics.read', 'analytics.write', 'analytics.batch_progress_rollups'));

RESET ROLE;
