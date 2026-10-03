-- Rollback batch-department projection populator and assignment rule backfill support.
SET ROLE aether_assessment_owner;

DROP FUNCTION IF EXISTS assessment.backfill_from_assignment_rule(uuid, uuid, uuid, text, uuid);
DROP FUNCTION IF EXISTS assessment.apply_batch_projection(uuid, uuid, uuid, uuid);
DROP FUNCTION IF EXISTS assessment.apply_student_enrollment(uuid, uuid, uuid, uuid);
DROP TABLE IF EXISTS assessment.student_batch_enrollments;

RESET ROLE;
