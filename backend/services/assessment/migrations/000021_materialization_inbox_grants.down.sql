SET ROLE aether_assessment_owner;

REVOKE SELECT, INSERT, UPDATE ON app.projection_inbox_messages FROM aether_assessment_projection_worker;
REVOKE USAGE ON SCHEMA app FROM aether_assessment_projection_worker;

RESET ROLE;
