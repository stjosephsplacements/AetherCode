SET ROLE aether_assessment_owner;

DROP FUNCTION IF EXISTS assessment.remove_exam_section(uuid, uuid, uuid, bigint);
DROP FUNCTION IF EXISTS assessment.remove_exam_item(uuid, uuid, uuid, bigint);

RESET ROLE;
