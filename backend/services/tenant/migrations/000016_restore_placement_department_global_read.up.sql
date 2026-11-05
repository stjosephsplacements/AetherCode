SET ROLE aether_tenant_owner;

-- 000015 rebuilt departments_app_read without the platform-wide branch that 000003 added for
-- placement departments. A platform administrator could then not read a placement department
-- back, so creating one (INSERT ... RETURNING) failed the row-level security check. Keep the
-- node scope for college departments and restore the global branch.
DROP POLICY IF EXISTS departments_app_read ON tenant.departments;

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
            OR authz.current_global_context_allows('tenant.read', 'tenant.placement_organizations')
            OR authz.current_global_context_allows('tenant.write', 'tenant.placement_organizations')
        ))
    );

RESET ROLE;
