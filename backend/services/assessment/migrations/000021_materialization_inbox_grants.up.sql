SET ROLE aether_assessment_owner;

-- 000010 created the materialization consumers' inbox in schema app but never
-- let the projection worker, which runs those consumers, reach it, so every
-- batch and enrollment event failed and no candidate assignment was ever
-- materialized.
GRANT USAGE ON SCHEMA app TO aether_assessment_projection_worker;
GRANT SELECT, INSERT, UPDATE ON app.projection_inbox_messages TO aether_assessment_projection_worker;

RESET ROLE;
