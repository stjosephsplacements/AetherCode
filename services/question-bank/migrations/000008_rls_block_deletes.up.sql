-- Enforce soft delete: block direct DELETE via RLS.
-- Existing signed_read/insert/update policies from 000002 remain intact.
-- The RESTRICTIVE block_delete policy AND-combines with them: false AND anything = false.
-- app.hard_delete() SECURITY DEFINER bypasses RLS entirely.

SET ROLE aether_question_bank_owner;

-- DELETE privilege already granted in 000002; repeated here for clarity/idempotency
GRANT DELETE ON qbank.questions TO aether_question_bank_app;
GRANT DELETE ON qbank.question_versions TO aether_question_bank_app;

-- Replace the permissive signed_delete policies with restrictive total blocks
DROP POLICY IF EXISTS qbank_questions_signed_delete ON qbank.questions;
DROP POLICY IF EXISTS qbank_question_versions_signed_delete ON qbank.question_versions;

CREATE POLICY block_delete ON qbank.questions
    AS RESTRICTIVE
    FOR DELETE TO aether_question_bank_app
    USING (false);

CREATE POLICY block_delete ON qbank.question_versions
    AS RESTRICTIVE
    FOR DELETE TO aether_question_bank_app
    USING (false);

COMMENT ON POLICY block_delete ON qbank.questions IS
    'RESTRICTIVE: blocks all DELETE for app role. Use app.hard_delete() SECURITY DEFINER for physical removal.';

COMMENT ON POLICY block_delete ON qbank.question_versions IS
    'RESTRICTIVE: blocks all DELETE for app role. Use app.hard_delete() SECURITY DEFINER for physical removal.';

RESET ROLE;
