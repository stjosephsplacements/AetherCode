SET ROLE aether_user_owner;

DROP TRIGGER IF EXISTS tenant_department_seed_college_roles ON users.tenant_department_projections;
DROP FUNCTION IF EXISTS users.seed_college_roles_for_department();
-- The roles it seeded stay: they are managed rows that assignments may already reference.

RESET ROLE;
