SET ROLE aether_tenant_owner;

DROP POLICY IF EXISTS departments_app_read ON tenant.departments;

-- Back to the 000015 policy.
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

RESET ROLE;
