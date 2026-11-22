SET ROLE aether_submission_owner;

DROP FUNCTION IF EXISTS submission.purge_code_runs_for_attempt(uuid, uuid, uuid, text);
DROP FUNCTION IF EXISTS submission.purge_expired_code_runs(integer);

RESET ROLE;