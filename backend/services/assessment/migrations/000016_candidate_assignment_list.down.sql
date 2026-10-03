SET ROLE aether_assessment_owner;

DROP FUNCTION IF EXISTS assessment.list_candidate_assignments(uuid, integer, timestamptz, uuid, text);

DROP INDEX IF EXISTS assessment.candidate_assignments_candidate_idx;
CREATE INDEX candidate_assignments_candidate_idx
    ON assessment.candidate_assignments (tenant_id, candidate_id, available_from, available_until);

RESET ROLE;
