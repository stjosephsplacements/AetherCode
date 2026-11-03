SET ROLE aether_user_owner;

DROP POLICY IF EXISTS overwrites_app_delete ON users.permission_overwrites;
DROP POLICY IF EXISTS overwrites_app_update ON users.permission_overwrites;
DROP POLICY IF EXISTS overwrites_app_insert ON users.permission_overwrites;
DROP POLICY IF EXISTS overwrites_app_read ON users.permission_overwrites;
DROP POLICY IF EXISTS roles_app_delete ON users.roles;
DROP POLICY IF EXISTS roles_app_update ON users.roles;
DROP POLICY IF EXISTS roles_app_insert ON users.roles;
DROP POLICY IF EXISTS roles_app_read ON users.roles;
DROP POLICY IF EXISTS permission_flags_app_read ON users.permission_flags;
REVOKE ALL ON users.roles, users.permission_overwrites, users.permission_flags FROM aether_user_app;
DROP TRIGGER IF EXISTS permission_overwrites_enforce_hierarchy ON users.permission_overwrites;
DROP TRIGGER IF EXISTS role_assignments_enforce_custom ON users.role_assignments;
DROP TRIGGER IF EXISTS roles_enforce_hierarchy ON users.roles;
DROP FUNCTION IF EXISTS users.enforce_overwrite_hierarchy();
DROP FUNCTION IF EXISTS users.enforce_custom_assignment();
DROP FUNCTION IF EXISTS users.enforce_role_hierarchy();
DROP FUNCTION IF EXISTS users.principal_bits(uuid, uuid);
DROP FUNCTION IF EXISTS users.principal_rank(uuid, uuid);
DROP VIEW IF EXISTS users.assignment_roles;
DELETE FROM users.role_assignments WHERE role_name = 'custom';
ALTER TABLE users.role_assignments DROP CONSTRAINT role_assignments_check3;
ALTER TABLE users.role_assignments ADD CONSTRAINT role_assignments_check3 CHECK (
    (role_name = 'super_admin' AND scope_kind = 'platform')
    OR (role_name = 'placement_user' AND scope_kind IN ('platform', 'placement_department'))
    OR (role_name = 'college_admin' AND scope_kind = 'college')
    OR (role_name = 'department_user' AND scope_kind = 'department')
    OR (role_name = 'mentor' AND scope_kind IN ('department', 'batch'))
    OR (role_name = 'student' AND scope_kind = 'self')
);
ALTER TABLE users.role_assignments DROP CONSTRAINT role_assignments_role_name_check;
ALTER TABLE users.role_assignments ADD CONSTRAINT role_assignments_role_name_check CHECK (role_name IN (
    'super_admin', 'placement_user', 'college_admin', 'department_user', 'mentor', 'student'
));

RESET ROLE;
