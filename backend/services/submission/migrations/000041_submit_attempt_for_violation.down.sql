SET ROLE aether_submission_owner;

DROP FUNCTION IF EXISTS submission.submit_attempt_for_violation(uuid, text);

RESET ROLE;
