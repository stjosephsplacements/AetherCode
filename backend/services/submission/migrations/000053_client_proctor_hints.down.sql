SET ROLE aether_submission_owner;

DROP FUNCTION IF EXISTS submission.list_client_proctor_hints(uuid, uuid);
DROP FUNCTION IF EXISTS submission.record_client_proctor_hint(uuid, uuid, text, real);
DROP TABLE IF EXISTS submission.attempt_client_proctor_hints;

RESET ROLE;