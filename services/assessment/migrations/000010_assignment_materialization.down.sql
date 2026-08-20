SET ROLE aether_assessment_owner;

DROP TABLE IF EXISTS assessment.batch_department_projections CASCADE;
DROP FUNCTION IF EXISTS assessment.materialize_from_batch_affiliation(uuid, uuid, uuid, uuid, text) CASCADE;
DROP FUNCTION IF EXISTS assessment.materialize_from_enrollment(uuid, uuid, uuid, uuid) CASCADE;
DROP TABLE IF EXISTS app.projection_inbox_messages CASCADE;

RESET ROLE;
