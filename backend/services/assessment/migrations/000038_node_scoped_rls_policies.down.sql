SET ROLE aether_assessment_owner;

REVOKE EXECUTE ON FUNCTION authz.current_context_covers_node(uuid)
    FROM aether_assessment_app;

DROP POLICY IF EXISTS batch_department_projections_app_read ON assessment.batch_department_projections;
DROP POLICY IF EXISTS batch_department_projections_projection_worker ON assessment.batch_department_projections;
DROP POLICY IF EXISTS batch_department_projections_owner_maintenance ON assessment.batch_department_projections;
ALTER TABLE assessment.batch_department_projections DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS student_batch_enrollments_app_read ON assessment.student_batch_enrollments;
DROP POLICY IF EXISTS student_batch_enrollments_projection_worker ON assessment.student_batch_enrollments;
DROP POLICY IF EXISTS student_batch_enrollments_owner_maintenance ON assessment.student_batch_enrollments;
ALTER TABLE assessment.student_batch_enrollments DISABLE ROW LEVEL SECURITY;

RESET ROLE;
