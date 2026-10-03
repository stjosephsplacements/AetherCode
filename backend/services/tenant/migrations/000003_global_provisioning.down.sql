SET ROLE aether_tenant_owner;

DROP POLICY departments_app_read ON tenant.departments;
DROP POLICY departments_app_insert ON tenant.departments;
DROP POLICY departments_app_update ON tenant.departments;
DROP POLICY departments_app_delete ON tenant.departments;
CREATE POLICY departments_app_read ON tenant.departments FOR SELECT TO aether_tenant_app
    USING ((department_type = 'college' AND (authz.current_context_allows(tenant_id, 'tenant.read', 'tenant.departments') OR authz.current_context_allows(tenant_id, 'tenant.write', 'tenant.departments')))
        OR (department_type = 'placement' AND (authz.current_context_allows_placement(id, 'tenant.read', 'tenant.departments') OR authz.current_context_allows_placement(id, 'tenant.write', 'tenant.departments'))));
CREATE POLICY departments_app_insert ON tenant.departments FOR INSERT TO aether_tenant_app
    WITH CHECK ((department_type = 'college' AND authz.current_context_allows(tenant_id, 'tenant.write', 'tenant.departments'))
        OR (department_type = 'placement' AND authz.current_context_allows_placement(id, 'tenant.write', 'tenant.departments')));
CREATE POLICY departments_app_update ON tenant.departments FOR UPDATE TO aether_tenant_app
    USING ((department_type = 'college' AND authz.current_context_allows(tenant_id, 'tenant.write', 'tenant.departments'))
        OR (department_type = 'placement' AND authz.current_context_allows_placement(id, 'tenant.write', 'tenant.departments')))
    WITH CHECK ((department_type = 'college' AND authz.current_context_allows(tenant_id, 'tenant.write', 'tenant.departments'))
        OR (department_type = 'placement' AND authz.current_context_allows_placement(id, 'tenant.write', 'tenant.departments')));
CREATE POLICY departments_app_delete ON tenant.departments FOR DELETE TO aether_tenant_app
    USING ((department_type = 'college' AND authz.current_context_allows(tenant_id, 'tenant.write', 'tenant.departments'))
        OR (department_type = 'placement' AND authz.current_context_allows_placement(id, 'tenant.write', 'tenant.departments')));

DROP POLICY retention_policies_app_insert ON tenant.retention_policies;
CREATE POLICY retention_policies_app_insert ON tenant.retention_policies FOR INSERT TO aether_tenant_app
    WITH CHECK (authz.current_context_allows(tenant_id, 'tenant.write', 'tenant.retention_policies'));

DROP POLICY tenants_app_read ON tenant.tenants;
DROP POLICY tenants_app_insert ON tenant.tenants;
DROP POLICY tenants_app_update ON tenant.tenants;
DROP POLICY tenants_app_delete ON tenant.tenants;
CREATE POLICY tenants_app_read ON tenant.tenants FOR SELECT TO aether_tenant_app
    USING (authz.current_context_allows(id, 'tenant.read', 'tenant.tenants') OR authz.current_context_allows(id, 'tenant.write', 'tenant.tenants'));
CREATE POLICY tenants_app_insert ON tenant.tenants FOR INSERT TO aether_tenant_app
    WITH CHECK (authz.current_context_allows(id, 'tenant.write', 'tenant.tenants'));
CREATE POLICY tenants_app_update ON tenant.tenants FOR UPDATE TO aether_tenant_app
    USING (authz.current_context_allows(id, 'tenant.write', 'tenant.tenants'))
    WITH CHECK (authz.current_context_allows(id, 'tenant.write', 'tenant.tenants'));
CREATE POLICY tenants_app_delete ON tenant.tenants FOR DELETE TO aether_tenant_app
    USING (authz.current_context_allows(id, 'tenant.write', 'tenant.tenants'));

RESET ROLE;
