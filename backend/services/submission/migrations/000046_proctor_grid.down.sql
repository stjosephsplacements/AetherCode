SET ROLE aether_submission_owner;

DROP FUNCTION IF EXISTS submission.proctor_grid(uuid, uuid, integer);
DROP FUNCTION IF EXISTS submission.record_attempt_violation(uuid, uuid, text, timestamptz);
DROP TABLE IF EXISTS submission.attempt_violation_counts;

RESET ROLE;
