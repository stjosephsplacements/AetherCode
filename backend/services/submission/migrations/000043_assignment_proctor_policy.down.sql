SET ROLE aether_submission_owner;

DROP FUNCTION IF EXISTS submission.get_attempt_proctor_policy(uuid, uuid);
DROP FUNCTION IF EXISTS submission.set_assignment_proctor_policy(uuid, uuid, bigint, jsonb);
ALTER TABLE submission.assignment_projections DROP COLUMN IF EXISTS proctor_policy;

RESET ROLE;
