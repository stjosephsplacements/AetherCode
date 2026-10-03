SET ROLE aether_tenant_owner;

-- A platform-scoped tenant provisioning command creates the tenant and its
-- default retention row atomically under one signed global capability. Normal
-- tenant-scoped operations continue to require their exact tenant context.
DROP POLICY tenants_app_read ON tenant.tenants;
DROP POLICY tenants_app_insert ON tenant.tenants;
DROP POLICY tenants_app_update ON tenant.tenants;
DROP POLICY tenants_app_delete ON tenant.tenants;

CREATE POLICY tenants_app_read ON tenant.tenants FOR SELECT TO aether_tenant_app
    USING (
        authz.current_context_allows(id, 'tenant.read', 'tenant.tenants')
        OR authz.current_context_allows(id, 'tenant.write', 'tenant.tenants')
        OR authz.current_global_context_allows('tenant.read', 'tenant.tenants')
        OR authz.current_global_context_allows('tenant.write', 'tenant.tenants')
    );
CREATE POLICY tenants_app_insert ON tenant.tenants FOR INSERT TO aether_tenant_app
    WITH CHECK (
        authz.current_context_allows(id, 'tenant.write', 'tenant.tenants')
        OR authz.current_global_context_allows('tenant.write', 'tenant.tenants')
    );
CREATE POLICY tenants_app_update ON tenant.tenants FOR UPDATE TO aether_tenant_app
    USING (
        authz.current_context_allows(id, 'tenant.write', 'tenant.tenants')
        OR authz.current_global_context_allows('tenant.write', 'tenant.tenants')
    ) WITH CHECK (
        authz.current_context_allows(id, 'tenant.write', 'tenant.tenants')
        OR authz.current_global_context_allows('tenant.write', 'tenant.tenants')
    );
CREATE POLICY tenants_app_delete ON tenant.tenants FOR DELETE TO aether_tenant_app
    USING (
        authz.current_context_allows(id, 'tenant.write', 'tenant.tenants')
        OR authz.current_global_context_allows('tenant.write', 'tenant.tenants')
    );

DROP POLICY retention_policies_app_insert ON tenant.retention_policies;
CREATE POLICY retention_policies_app_insert ON tenant.retention_policies FOR INSERT TO aether_tenant_app
    WITH CHECK (
        authz.current_context_allows(tenant_id, 'tenant.write', 'tenant.retention_policies')
        OR authz.current_global_context_allows('tenant.write', 'tenant.tenants')
    );

DROP POLICY departments_app_read ON tenant.departments;
DROP POLICY departments_app_insert ON tenant.departments;
DROP POLICY departments_app_update ON tenant.departments;
DROP POLICY departments_app_delete ON tenant.departments;

CREATE POLICY departments_app_read ON tenant.departments FOR SELECT TO aether_tenant_app
    USING (
        (department_type = 'college' AND (
            authz.current_context_allows(tenant_id, 'tenant.read', 'tenant.departments')
            OR authz.current_context_allows(tenant_id, 'tenant.write', 'tenant.departments')
        ))
        OR (department_type = 'placement' AND (
            authz.current_context_allows_placement(id, 'tenant.read', 'tenant.departments')
            OR authz.current_context_allows_placement(id, 'tenant.write', 'tenant.departments')
            OR authz.current_global_context_allows('tenant.read', 'tenant.placement_organizations')
            OR authz.current_global_context_allows('tenant.write', 'tenant.placement_organizations')
        ))
    );
CREATE POLICY departments_app_insert ON tenant.departments FOR INSERT TO aether_tenant_app
    WITH CHECK (
        (department_type = 'college' AND authz.current_context_allows(tenant_id, 'tenant.write', 'tenant.departments'))
        OR (department_type = 'placement' AND (
            authz.current_context_allows_placement(id, 'tenant.write', 'tenant.departments')
            OR authz.current_global_context_allows('tenant.write', 'tenant.placement_organizations')
        ))
    );
CREATE POLICY departments_app_update ON tenant.departments FOR UPDATE TO aether_tenant_app
    USING (
        (department_type = 'college' AND authz.current_context_allows(tenant_id, 'tenant.write', 'tenant.departments'))
        OR (department_type = 'placement' AND (
            authz.current_context_allows_placement(id, 'tenant.write', 'tenant.departments')
            OR authz.current_global_context_allows('tenant.write', 'tenant.placement_organizations')
        ))
    ) WITH CHECK (
        (department_type = 'college' AND authz.current_context_allows(tenant_id, 'tenant.write', 'tenant.departments'))
        OR (department_type = 'placement' AND (
            authz.current_context_allows_placement(id, 'tenant.write', 'tenant.departments')
            OR authz.current_global_context_allows('tenant.write', 'tenant.placement_organizations')
        ))
    );
CREATE POLICY departments_app_delete ON tenant.departments FOR DELETE TO aether_tenant_app
    USING (
        (department_type = 'college' AND authz.current_context_allows(tenant_id, 'tenant.write', 'tenant.departments'))
        OR (department_type = 'placement' AND (
            authz.current_context_allows_placement(id, 'tenant.write', 'tenant.departments')
            OR authz.current_global_context_allows('tenant.write', 'tenant.placement_organizations')
        ))
    );

RESET ROLE;
