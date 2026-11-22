SET ROLE aether_tenant_owner;

REVOKE ALL ON FUNCTION tenant.public_branding(uuid) FROM aether_tenant_app;
REVOKE ALL ON FUNCTION tenant.public_branding_logo(uuid) FROM aether_tenant_app;
DROP FUNCTION IF EXISTS tenant.public_branding_logo(uuid);
DROP FUNCTION IF EXISTS tenant.public_branding(uuid);

DROP POLICY IF EXISTS branding_logos_owner_maintenance ON tenant.branding_logos;
DROP POLICY IF EXISTS branding_owner_maintenance ON tenant.branding;
DROP POLICY IF EXISTS branding_logos_app_delete ON tenant.branding_logos;
DROP POLICY IF EXISTS branding_logos_app_update ON tenant.branding_logos;
DROP POLICY IF EXISTS branding_logos_app_insert ON tenant.branding_logos;
DROP POLICY IF EXISTS branding_logos_app_read ON tenant.branding_logos;
DROP POLICY IF EXISTS branding_app_delete ON tenant.branding;
DROP POLICY IF EXISTS branding_app_update ON tenant.branding;
DROP POLICY IF EXISTS branding_app_insert ON tenant.branding;
DROP POLICY IF EXISTS branding_app_read ON tenant.branding;

DROP TABLE IF EXISTS tenant.branding_logos;
DROP TABLE IF EXISTS tenant.branding;

RESET ROLE;