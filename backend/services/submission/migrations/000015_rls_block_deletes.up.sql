-- Enforce soft delete: block direct DELETE via RLS.
-- Existing signed_read/insert/update policies from 000002 remain intact.
-- The RESTRICTIVE block_delete policy AND-combines with them: false AND anything = false.
-- app.hard_delete() SECURITY DEFINER bypasses RLS entirely.

SET ROLE aether_submission_owner;

-- DELETE privilege already granted in 000002; repeated here for clarity/idempotency
GRANT DELETE ON submission.attempts TO aether_submission_app;

-- Replace the permissive signed_delete with a restrictive total block
DROP POLICY IF EXISTS submission_attempts_signed_delete ON submission.attempts;

CREATE POLICY block_delete ON submission.attempts
    AS RESTRICTIVE
    FOR DELETE TO aether_submission_app
    USING (false);

COMMENT ON POLICY block_delete ON submission.attempts IS
    'RESTRICTIVE: blocks all DELETE for app role. Use app.hard_delete() SECURITY DEFINER for physical removal.';

RESET ROLE;
