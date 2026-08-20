-- Rollback: remove restrictive block_delete and restore original signed_delete policies from 000002.

SET ROLE aether_tenant_owner;

DROP POLICY IF EXISTS block_delete ON tenant.tenants;
DROP POLICY IF EXISTS block_delete ON tenant.departments;
DROP POLICY IF EXISTS block_delete ON tenant.batches;
DROP POLICY IF EXISTS block_delete ON tenant.placement_organizations;

-- Restore original signed_delete policies from 000002_tenant_domain.up.sql
CREATE POLICY tenants_app_delete ON tenant.tenants FOR DELETE TO aether_tenant_app
    USING (authz.current_context_allows(id, 'tenant.write', 'tenant.tenants'));

CREATE POLICY departments_app_delete ON tenant.departments FOR DELETE TO aether_tenant_app
    USING (
        (department_type = 'college' AND authz.current_context_allows(tenant_id, 'tenant.write', 'tenant.departments'))
        OR (department_type = 'placement' AND authz.current_context_allows_placement(id, 'tenant.write', 'tenant.departments'))
    );

CREATE POLICY batches_app_delete ON tenant.batches FOR DELETE TO aether_tenant_app
    USING (authz.current_context_allows(tenant_id, 'tenant.write', 'tenant.batches'));

CREATE POLICY placement_organizations_app_delete ON tenant.placement_organizations FOR DELETE TO aether_tenant_app
    USING (authz.current_global_context_allows('tenant.write', 'tenant.placement_organizations'));

RESET ROLE;
