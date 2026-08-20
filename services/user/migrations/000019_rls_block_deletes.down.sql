-- Rollback: remove restrictive block_delete and restore original signed_delete policies from 000002.

SET ROLE aether_user_owner;

DROP POLICY IF EXISTS block_delete ON users.profiles;
DROP POLICY IF EXISTS block_delete ON users.students;
DROP POLICY IF EXISTS block_delete ON users.role_assignments;
DROP POLICY IF EXISTS block_delete ON users.mentor_batch_assignments;
DROP POLICY IF EXISTS block_delete ON users.student_department_memberships;

-- Restore original signed_delete policies from 000002_user_domain.up.sql
CREATE POLICY profiles_app_delete ON users.profiles FOR DELETE TO aether_user_app
    USING (users.current_context_allows_profile(principal_id, 'user.write', 'users.profiles'));

CREATE POLICY students_app_delete ON users.students FOR DELETE TO aether_user_app
    USING (users.current_context_valid_student(tenant_id, id, 'user.write', 'users.students'));

CREATE POLICY role_assignments_app_delete ON users.role_assignments FOR DELETE TO aether_user_app
    USING (
        (tenant_id IS NOT NULL AND authz.current_context_allows(tenant_id, 'user.write', 'users.role_assignments'))
        OR (scope_kind = 'placement_department' AND authz.current_context_allows_placement(scope_id, 'user.write', 'users.role_assignments'))
        OR (tenant_id IS NULL AND authz.current_global_context_allows('user.write', 'users.role_assignments'))
    );

CREATE POLICY mentor_batch_assignments_app_delete ON users.mentor_batch_assignments FOR DELETE TO aether_user_app
    USING (authz.current_context_allows(tenant_id, 'user.write', 'users.mentor_batch_assignments'));

CREATE POLICY student_memberships_app_delete ON users.student_department_memberships FOR DELETE TO aether_user_app
    USING (users.current_context_valid_student(tenant_id, student_id, 'user.write', 'users.student_department_memberships'));

RESET ROLE;
