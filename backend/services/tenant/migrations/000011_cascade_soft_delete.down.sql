SET ROLE aether_tenant_owner;

DROP TRIGGER IF EXISTS cascade_department_soft_delete_trigger ON tenant.departments;
DROP FUNCTION IF EXISTS tenant.cascade_department_soft_delete();
DROP TRIGGER IF EXISTS cascade_tenant_soft_delete_trigger ON tenant.tenants;
DROP FUNCTION IF EXISTS tenant.cascade_tenant_soft_delete();

RESET ROLE;
