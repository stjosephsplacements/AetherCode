-- Rollback: remove restrictive block_delete and restore original signed_delete policy from 000002.

SET ROLE aether_submission_owner;

DROP POLICY IF EXISTS block_delete ON submission.attempts;

-- Restore original signed_delete policy (created by DO loop in 000002_domain.up.sql)
CREATE POLICY submission_attempts_signed_delete ON submission.attempts
    FOR DELETE TO aether_submission_app
    USING (authz.current_context_allows(tenant_id, 'submission.write', 'submission.attempts'));

RESET ROLE;
