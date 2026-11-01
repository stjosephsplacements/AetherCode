SET ROLE aether_assessment_owner;

DROP FUNCTION assessment.update_exam_item(uuid, uuid, uuid, bigint, numeric);
DROP FUNCTION assessment.update_exam_section(uuid, uuid, uuid, bigint, text, text, integer, boolean);
DROP FUNCTION assessment.update_exam_version(uuid, uuid, bigint, text, text, timestamptz, timestamptz, integer);

RESET ROLE;
