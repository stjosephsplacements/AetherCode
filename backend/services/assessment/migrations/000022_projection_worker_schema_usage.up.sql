SET ROLE aether_assessment_owner;

-- The projection worker holds EXECUTE on the materialization functions
-- (000010, 000011) but could not use their schema, so every call failed with
-- permission denied for schema assessment.
GRANT USAGE ON SCHEMA assessment TO aether_assessment_projection_worker;

RESET ROLE;
