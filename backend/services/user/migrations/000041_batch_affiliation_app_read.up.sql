-- ListStudents filters by batch through users.current_student_batch_affiliations, but the application
-- role had no privilege on it (migration 000013 only reaches it through SECURITY DEFINER functions), so
-- every student listing failed with "permission denied". Read access follows the student's own policy:
-- the signed context must be for that student's college and carry the students read or write action.
SET ROLE aether_user_owner;

CREATE POLICY current_student_batch_affiliations_app_read ON users.current_student_batch_affiliations
    FOR SELECT TO aether_user_app
    USING (
        users.current_context_valid_student(tenant_id, student_id, 'user.read', 'users.students')
        OR users.current_context_valid_student(tenant_id, student_id, 'user.write', 'users.students')
    );
GRANT SELECT ON users.current_student_batch_affiliations TO aether_user_app;

RESET ROLE;
