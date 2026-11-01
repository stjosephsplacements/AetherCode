SET ROLE aether_assessment_owner;

DROP FUNCTION assessment.soft_delete_exam(uuid, uuid, uuid, text);
DROP TRIGGER exams_reject_published_deletion ON assessment.exams;
DROP FUNCTION assessment.reject_published_exam_deletion();

DROP INDEX assessment.assignment_rules_deleted_at_idx;
ALTER TABLE assessment.assignment_rules DROP COLUMN deletion_reason, DROP COLUMN deleted_by, DROP COLUMN deleted_at;

RESET ROLE;
