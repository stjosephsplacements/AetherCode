SET ROLE aether_user_owner;

DROP INDEX IF EXISTS users.candidate_assignment_projections_active_candidate_idx;
DELETE FROM users.candidate_assignment_projections WHERE assignment_rule_id IS NULL;
ALTER TABLE users.candidate_assignment_projections
    DROP COLUMN version,
    DROP COLUMN lifecycle_state,
    DROP COLUMN exam_id,
    ALTER COLUMN assignment_rule_id SET NOT NULL;

RESET ROLE;
