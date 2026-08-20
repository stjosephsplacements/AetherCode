-- Enforce soft delete: block direct DELETE via RLS.
-- Existing signed_read/insert/update policies from 000002 remain intact.
-- The RESTRICTIVE block_delete policy AND-combines with them: false AND anything = false.
-- app.hard_delete() SECURITY DEFINER bypasses RLS entirely.

SET ROLE aether_user_owner;

-- DELETE privilege needed for RLS evaluation
GRANT DELETE ON users.profiles TO aether_user_app;
GRANT DELETE ON users.students TO aether_user_app;
GRANT DELETE ON users.role_assignments TO aether_user_app;
GRANT DELETE ON users.mentor_batch_assignments TO aether_user_app;
GRANT DELETE ON users.student_department_memberships TO aether_user_app;

-- Replace the permissive signed_delete policies with restrictive total blocks
DROP POLICY IF EXISTS profiles_app_delete ON users.profiles;
DROP POLICY IF EXISTS students_app_delete ON users.students;
DROP POLICY IF EXISTS role_assignments_app_delete ON users.role_assignments;
DROP POLICY IF EXISTS mentor_batch_assignments_app_delete ON users.mentor_batch_assignments;
DROP POLICY IF EXISTS student_memberships_app_delete ON users.student_department_memberships;

CREATE POLICY block_delete ON users.profiles
    AS RESTRICTIVE
    FOR DELETE TO aether_user_app
    USING (false);

CREATE POLICY block_delete ON users.students
    AS RESTRICTIVE
    FOR DELETE TO aether_user_app
    USING (false);

CREATE POLICY block_delete ON users.role_assignments
    AS RESTRICTIVE
    FOR DELETE TO aether_user_app
    USING (false);

CREATE POLICY block_delete ON users.mentor_batch_assignments
    AS RESTRICTIVE
    FOR DELETE TO aether_user_app
    USING (false);

CREATE POLICY block_delete ON users.student_department_memberships
    AS RESTRICTIVE
    FOR DELETE TO aether_user_app
    USING (false);

COMMENT ON POLICY block_delete ON users.profiles IS
    'RESTRICTIVE: blocks all DELETE for app role. Use app.hard_delete() SECURITY DEFINER for physical removal.';

COMMENT ON POLICY block_delete ON users.students IS
    'RESTRICTIVE: blocks all DELETE for app role. Use app.hard_delete() SECURITY DEFINER for physical removal.';

COMMENT ON POLICY block_delete ON users.role_assignments IS
    'RESTRICTIVE: blocks all DELETE for app role. Use app.hard_delete() SECURITY DEFINER for physical removal.';

COMMENT ON POLICY block_delete ON users.mentor_batch_assignments IS
    'RESTRICTIVE: blocks all DELETE for app role. Use app.hard_delete() SECURITY DEFINER for physical removal.';

COMMENT ON POLICY block_delete ON users.student_department_memberships IS
    'RESTRICTIVE: blocks all DELETE for app role. Use app.hard_delete() SECURITY DEFINER for physical removal.';

RESET ROLE;
