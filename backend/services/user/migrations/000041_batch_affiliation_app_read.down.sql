SET ROLE aether_user_owner;

REVOKE SELECT ON users.current_student_batch_affiliations FROM aether_user_app;
DROP POLICY IF EXISTS current_student_batch_affiliations_app_read ON users.current_student_batch_affiliations;

RESET ROLE;
