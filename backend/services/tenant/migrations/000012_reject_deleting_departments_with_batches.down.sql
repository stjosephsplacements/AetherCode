SET ROLE aether_tenant_owner;

DROP TRIGGER departments_reject_deleting_with_batches ON tenant.departments;
DROP FUNCTION tenant.reject_deleting_department_with_batches();

RESET ROLE;
