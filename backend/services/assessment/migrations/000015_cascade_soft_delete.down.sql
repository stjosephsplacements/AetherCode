SET ROLE aether_assessment_owner;

DROP TRIGGER IF EXISTS cascade_exam_version_soft_delete_trigger ON assessment.exam_versions;
DROP FUNCTION IF EXISTS assessment.cascade_exam_version_soft_delete();
DROP TRIGGER IF EXISTS cascade_exam_soft_delete_trigger ON assessment.exams;
DROP FUNCTION IF EXISTS assessment.cascade_exam_soft_delete();

RESET ROLE;
