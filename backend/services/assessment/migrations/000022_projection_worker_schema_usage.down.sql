SET ROLE aether_assessment_owner;

REVOKE USAGE ON SCHEMA assessment FROM aether_assessment_projection_worker;

RESET ROLE;
