-- Rollback: remove restrictive block_delete and restore original signed_delete policies from 000002.

SET ROLE aether_assessment_owner;

DROP POLICY IF EXISTS block_delete ON assessment.exams;
DROP POLICY IF EXISTS block_delete ON assessment.exam_versions;
DROP POLICY IF EXISTS block_delete ON assessment.candidate_assignments;

-- Restore original signed_delete policies (created by DO loop in 000002_domain.up.sql)
CREATE POLICY assessment_exams_signed_delete ON assessment.exams
    FOR DELETE TO aether_assessment_app
    USING (authz.current_context_allows(tenant_id, 'assessment.write', 'assessment.exams'));

CREATE POLICY assessment_exam_versions_signed_delete ON assessment.exam_versions
    FOR DELETE TO aether_assessment_app
    USING (authz.current_context_allows(tenant_id, 'assessment.write', 'assessment.exam_versions'));

CREATE POLICY assessment_candidate_assignments_signed_delete ON assessment.candidate_assignments
    FOR DELETE TO aether_assessment_app
    USING (authz.current_context_allows(tenant_id, 'assessment.write', 'assessment.candidate_assignments'));

RESET ROLE;
