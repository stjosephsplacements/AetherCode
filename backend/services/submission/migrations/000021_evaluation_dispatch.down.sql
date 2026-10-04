-- Rolling back strands queued grading work, so it refuses to run while any
-- evaluation request is still waiting for dispatch.
SET ROLE aether_submission_owner;

DO $rollback_guard$
BEGIN
    IF EXISTS (SELECT 1 FROM submission.evaluation_requests WHERE lifecycle_state = 'queued') THEN
        RAISE EXCEPTION 'cannot roll back evaluation dispatch while evaluation requests are queued';
    END IF;
END
$rollback_guard$;

DROP FUNCTION submission.mark_evaluation_dispatched(uuid, uuid, uuid);
DROP FUNCTION submission.claim_evaluation_requests(integer, integer);
DROP INDEX submission.evaluation_requests_dispatch_idx;
ALTER TABLE submission.evaluation_requests
    DROP COLUMN dispatch_after,
    DROP COLUMN dispatch_attempts;

RESET ROLE;
