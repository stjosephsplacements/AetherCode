SET ROLE aether_tenant_owner;

-- Tighten the read policies on tenant.departments and tenant.batches to enforce
-- node-scoped capability checks for department-scoped and batch-scoped staff.
--
-- tenant.departments: the node scope ID is the department UUID (id). A
--   department-scoped staff capability lists the department UUIDs in its nodes
--   array. College-level contexts (nodes IS NULL) see all tenant departments
--   because current_context_covers_node returns true when nodes IS NULL.
--
-- tenant.batches: the node scope ID is the batch UUID (id). A batch-scoped
--   staff capability lists the batch UUIDs in its nodes array.
--
-- The existing write/insert/update/delete policies remain unchanged. Only the
-- read policies are replaced because writes are already restricted to
-- college-level admins via current_context_allows (no scoped grants allow
-- writes to tenant schema tables).

-- departments ------------------------------------------------------------------

DROP POLICY IF EXISTS departments_app_read ON tenant.departments;

-- Retain the original placement-org branch unchanged; add node scope to the
-- college-department branch so department-scoped staff only see their node.
CREATE POLICY departments_app_read ON tenant.departments FOR SELECT TO aether_tenant_app
    USING (
        (department_type = 'college' AND (
            (
                authz.current_context_allows(tenant_id, 'tenant.read', 'tenant.departments')
                OR authz.current_context_allows(tenant_id, 'tenant.write', 'tenant.departments')
            )
            AND authz.current_context_covers_node(id)
        ))
        OR (department_type = 'placement' AND (
            authz.current_context_allows_placement(id, 'tenant.read', 'tenant.departments')
            OR authz.current_context_allows_placement(id, 'tenant.write', 'tenant.departments')
        ))
    );

-- batches ----------------------------------------------------------------------

DROP POLICY IF EXISTS batches_app_read ON tenant.batches;

-- Batch-scoped staff have the batch UUID in their capability nodes array.
-- current_context_covers_node(id) therefore filters to only the allowed batches.
-- College-level contexts pass because nodes IS NULL = unrestricted.
CREATE POLICY batches_app_read ON tenant.batches FOR SELECT TO aether_tenant_app
    USING (
        (
            authz.current_context_allows(tenant_id, 'tenant.read', 'tenant.batches')
            OR authz.current_context_allows(tenant_id, 'tenant.write', 'tenant.batches')
        )
        -- A department-scoped capability also covers the batches of that department.
        AND (authz.current_context_covers_node(id) OR authz.current_context_covers_node(department_id))
    );

GRANT EXECUTE ON FUNCTION authz.current_context_covers_node(uuid)
    TO aether_tenant_app;

RESET ROLE;
