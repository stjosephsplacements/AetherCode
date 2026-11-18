SET ROLE aether_submission_owner;

-- Block new attempts from starting between the check and the drop.
LOCK TABLE submission.attempts IN SHARE ROW EXCLUSIVE MODE;

-- Dropping the policy mid-exam would stop violation auto-submit for open attempts: refuse until they have drained.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM submission.attempts WHERE lifecycle_state IN ('active', 'submitted', 'grading')) THEN
        RAISE EXCEPTION 'cannot roll back the assignment proctor policy while attempts are active' USING ERRCODE = '55000';
    END IF;
END
$$;

DROP FUNCTION IF EXISTS submission.get_attempt_proctor_policy(uuid, uuid);
DROP FUNCTION IF EXISTS submission.set_assignment_proctor_policy(uuid, uuid, bigint, jsonb);
ALTER TABLE submission.assignment_projections DROP COLUMN IF EXISTS proctor_policy;

RESET ROLE;
