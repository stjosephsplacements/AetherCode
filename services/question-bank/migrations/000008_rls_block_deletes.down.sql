-- Rollback: remove restrictive block_delete and restore original signed_delete policies from 000002.

SET ROLE aether_question_bank_owner;

DROP POLICY IF EXISTS block_delete ON qbank.questions;
DROP POLICY IF EXISTS block_delete ON qbank.question_versions;

-- Restore original signed_delete policies (created by DO loop in 000002_domain.up.sql)
CREATE POLICY qbank_questions_signed_delete ON qbank.questions
    FOR DELETE TO aether_question_bank_app
    USING (authz.current_global_context_allows('qbank.write', 'qbank.questions', true));

CREATE POLICY qbank_question_versions_signed_delete ON qbank.question_versions
    FOR DELETE TO aether_question_bank_app
    USING (authz.current_global_context_allows('qbank.write', 'qbank.question_versions', true));

RESET ROLE;
