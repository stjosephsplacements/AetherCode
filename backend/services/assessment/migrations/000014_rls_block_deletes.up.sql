-- Enforce soft delete: block direct DELETE via RLS.
-- Existing signed_read/insert/update policies from 000002 remain intact.
-- The RESTRICTIVE block_delete policy AND-combines with them: false AND anything = false.
-- app.hard_delete() SECURITY DEFINER bypasses RLS entirely.

SET ROLE aether_assessment_owner;

-- DELETE privilege already granted in 000002; repeated here for clarity/idempotency
GRANT DELETE ON assessment.exams TO aether_assessment_app;
GRANT DELETE ON assessment.exam_versions TO aether_assessment_app;
GRANT DELETE ON assessment.candidate_assignments TO aether_assessment_app;

-- Replace the permissive signed_delete with a restrictive total block
DROP POLICY IF EXISTS assessment_exams_signed_delete ON assessment.exams;
DROP POLICY IF EXISTS assessment_exam_versions_signed_delete ON assessment.exam_versions;
DROP POLICY IF EXISTS assessment_candidate_assignments_signed_delete ON assessment.candidate_assignments;

CREATE POLICY block_delete ON assessment.exams
    AS RESTRICTIVE
    FOR DELETE TO aether_assessment_app
    USING (false);

CREATE POLICY block_delete ON assessment.exam_versions
    AS RESTRICTIVE
    FOR DELETE TO aether_assessment_app
    USING (false);

CREATE POLICY block_delete ON assessment.candidate_assignments
    AS RESTRICTIVE
    FOR DELETE TO aether_assessment_app
    USING (false);

COMMENT ON POLICY block_delete ON assessment.exams IS
    'RESTRICTIVE: blocks all DELETE for app role. Use app.hard_delete() SECURITY DEFINER for physical removal.';

COMMENT ON POLICY block_delete ON assessment.exam_versions IS
    'RESTRICTIVE: blocks all DELETE for app role. Use app.hard_delete() SECURITY DEFINER for physical removal.';

COMMENT ON POLICY block_delete ON assessment.candidate_assignments IS
    'RESTRICTIVE: blocks all DELETE for app role. Use app.hard_delete() SECURITY DEFINER for physical removal.';

RESET ROLE;
