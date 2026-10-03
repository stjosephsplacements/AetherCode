-- Enforce soft delete: block direct DELETE via RLS.
-- Existing signed_read/insert/update policies from 000002 remain intact.
-- The RESTRICTIVE block_delete policy AND-combines with them: false AND anything = false.
-- app.hard_delete() SECURITY DEFINER bypasses RLS entirely.

SET ROLE aether_tenant_owner;

-- DELETE privilege needed for RLS evaluation
GRANT DELETE ON tenant.tenants TO aether_tenant_app;
GRANT DELETE ON tenant.departments TO aether_tenant_app;
GRANT DELETE ON tenant.batches TO aether_tenant_app;
GRANT DELETE ON tenant.placement_organizations TO aether_tenant_app;

-- Replace the permissive signed_delete policies with restrictive total blocks
DROP POLICY IF EXISTS tenants_app_delete ON tenant.tenants;
DROP POLICY IF EXISTS departments_app_delete ON tenant.departments;
DROP POLICY IF EXISTS batches_app_delete ON tenant.batches;
DROP POLICY IF EXISTS placement_organizations_app_delete ON tenant.placement_organizations;

CREATE POLICY block_delete ON tenant.tenants
    AS RESTRICTIVE
    FOR DELETE TO aether_tenant_app
    USING (false);

CREATE POLICY block_delete ON tenant.departments
    AS RESTRICTIVE
    FOR DELETE TO aether_tenant_app
    USING (false);

CREATE POLICY block_delete ON tenant.batches
    AS RESTRICTIVE
    FOR DELETE TO aether_tenant_app
    USING (false);

CREATE POLICY block_delete ON tenant.placement_organizations
    AS RESTRICTIVE
    FOR DELETE TO aether_tenant_app
    USING (false);

COMMENT ON POLICY block_delete ON tenant.tenants IS
    'RESTRICTIVE: blocks all DELETE for app role. Use app.hard_delete() SECURITY DEFINER for physical removal.';

COMMENT ON POLICY block_delete ON tenant.departments IS
    'RESTRICTIVE: blocks all DELETE for app role. Use app.hard_delete() SECURITY DEFINER for physical removal.';

COMMENT ON POLICY block_delete ON tenant.batches IS
    'RESTRICTIVE: blocks all DELETE for app role. Use app.hard_delete() SECURITY DEFINER for physical removal.';

COMMENT ON POLICY block_delete ON tenant.placement_organizations IS
    'RESTRICTIVE: blocks all DELETE for app role. Use app.hard_delete() SECURITY DEFINER for physical removal.';

RESET ROLE;
