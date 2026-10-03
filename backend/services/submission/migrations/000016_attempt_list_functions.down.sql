SET ROLE aether_submission_owner;

DROP FUNCTION IF EXISTS submission.list_answer_revisions(uuid, uuid, integer, timestamptz, uuid, uuid);
DROP FUNCTION IF EXISTS submission.list_attempts(uuid, integer, timestamptz, uuid, uuid, text);

DROP INDEX IF EXISTS submission.attempts_candidate_idx;
CREATE INDEX attempts_candidate_idx
    ON submission.attempts (tenant_id, candidate_id, created_at DESC);

RESET ROLE;
