SET ROLE aether_tenant_owner;

REVOKE EXECUTE ON FUNCTION authz.current_context_covers_node(uuid)
    FROM aether_tenant_app;

DROP POLICY IF EXISTS batches_app_read ON tenant.batches;

-- Restore original tenant-level read policy for batches.
CREATE POLICY batches_app_read ON tenant.batches FOR SELECT TO aether_tenant_app
    USING (
        authz.current_context_allows(tenant_id, 'tenant.read', 'tenant.batches')
        OR authz.current_context_allows(tenant_id, 'tenant.write', 'tenant.batches')
    );

DROP POLICY IF EXISTS departments_app_read ON tenant.departments;

-- Restore original policy for departments.
CREATE POLICY departments_app_read ON tenant.departments FOR SELECT TO aether_tenant_app
    USING (
        (department_type = 'college' AND (
            authz.current_context_allows(tenant_id, 'tenant.read', 'tenant.departments')
            OR authz.current_context_allows(tenant_id, 'tenant.write', 'tenant.departments')
        ))
        OR (department_type = 'placement' AND (
            authz.current_context_allows_placement(id, 'tenant.read', 'tenant.departments')
            OR authz.current_context_allows_placement(id, 'tenant.write', 'tenant.departments')
        ))
    );

RESET ROLE;
