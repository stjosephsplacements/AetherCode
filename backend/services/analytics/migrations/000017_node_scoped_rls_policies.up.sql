SET ROLE aether_analytics_owner;

-- Enforce node-scoped capability checks on the three analytics tables that
-- expose per-batch or per-placement-department data to scoped staff contexts.
--
-- batch_progress_rollups: batch_id is the scope node. A batch-scoped staff
--   capability lists the batch UUIDs in its nodes array; college-level contexts
--   (nodes IS NULL) remain unrestricted.
--
-- placement_student_rollups: placement_department_id is the scope node.
--   Placement-scoped staff capabilities list the allowed placement dept UUIDs.
--
-- student_batch_affiliation_projections: already has RLS with only the owner
--   maintenance policy; the app has no direct read privilege. Add a node-scoped
--   app_read policy so department/batch staff can read affiliation data for
--   nodes in their signed capability. The node is batch_id (active affiliations
--   always carry a batch_id; inactive rows have batch_id IS NULL and only a
--   college-level context with nodes IS NULL may see them).
--
-- For batch_progress_rollups and placement_student_rollups the existing
-- tenant-level signed_read policies are dropped and replaced with node-aware
-- equivalents. The write policies are unchanged.

-- batch_progress_rollups -------------------------------------------------------

DROP POLICY IF EXISTS analytics_batch_progress_rollups_signed_read
    ON analytics.batch_progress_rollups;

-- Replace the old tenant-only read gate with one that also checks node scope.
-- current_context_allows_read already verifies tenant membership; we add the
-- node check as an AND so a batch-scoped staff member sees only their batches.
CREATE POLICY analytics_batch_progress_rollups_app_read
    ON analytics.batch_progress_rollups
    FOR SELECT TO aether_analytics_app
    USING (
        authz.current_context_allows_read(tenant_id, 'analytics.read', 'analytics.write', 'analytics.batch_progress_rollups')
        AND authz.current_context_covers_node(batch_id)
    );

-- placement_student_rollups ----------------------------------------------------

DROP POLICY IF EXISTS analytics_placement_student_rollups_signed_read
    ON analytics.placement_student_rollups;

CREATE POLICY analytics_placement_student_rollups_app_read
    ON analytics.placement_student_rollups
    FOR SELECT TO aether_analytics_app
    USING (
        authz.current_context_allows_read(tenant_id, 'analytics.read', 'analytics.write', 'analytics.placement_student_rollups')
        AND authz.current_context_covers_node(placement_department_id)
    );

-- student_batch_affiliation_projections ----------------------------------------
-- The app has no direct SELECT privilege on this table; the existing policy set
-- only grants the owner. Add an app_read policy restricted by batch node, and
-- grant the app SELECT so it can use the existing SECURITY DEFINER functions
-- that join against this table.

GRANT SELECT ON TABLE analytics.student_batch_affiliation_projections
    TO aether_analytics_app;

CREATE POLICY analytics_student_batch_affiliation_app_read
    ON analytics.student_batch_affiliation_projections
    FOR SELECT TO aether_analytics_app
    USING (
        authz.current_context_allows_read(tenant_id, 'analytics.read', 'analytics.write', 'analytics.student_batch_affiliation_projections')
        AND (
            -- Inactive affiliations carry no batch_id. They may only be read by a
            -- college-level context (nodes IS NULL = unrestricted in covers_node).
            -- Active affiliations are gated by batch_id node coverage.
            (lifecycle_state = 'inactive' AND authz.current_context_covers_node(NULL))
            OR (lifecycle_state = 'active' AND authz.current_context_covers_node(batch_id))
        )
    );

GRANT EXECUTE ON FUNCTION authz.current_context_covers_node(uuid)
    TO aether_analytics_app;

RESET ROLE;
