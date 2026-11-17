-- The exam's proctor policy, projected from Assessment's assignment snapshot
-- (ADR-0080), so each webcam frame can carry it to the proctor service.
SET ROLE aether_submission_owner;

ALTER TABLE submission.assignment_projections
    ADD COLUMN proctor_policy jsonb CHECK (proctor_policy IS NULL OR jsonb_typeof(proctor_policy) = 'object');

-- Applied in the same transaction as apply_assignment_snapshot; a snapshot
-- older than the stored version never overwrites the policy.
CREATE FUNCTION submission.set_assignment_proctor_policy(
    p_tenant_id uuid, p_candidate_assignment_id uuid, p_version bigint, p_policy jsonb
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, submission
AS $function$
BEGIN
    IF p_tenant_id IS NULL OR p_candidate_assignment_id IS NULL OR p_version IS NULL
       OR (p_policy IS NOT NULL AND pg_catalog.jsonb_typeof(p_policy) <> 'object') THEN
        RAISE EXCEPTION 'proctor policy fields are invalid' USING ERRCODE = '22023';
    END IF;
    UPDATE submission.assignment_projections
    SET proctor_policy = p_policy
    WHERE tenant_id = p_tenant_id
      AND candidate_assignment_id = p_candidate_assignment_id
      AND version = p_version;
END
$function$;

-- Read by the snapshot upload, under the candidate's own signed context.
CREATE FUNCTION submission.get_attempt_proctor_policy(p_tenant_id uuid, p_attempt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, authz, submission
AS $function$
BEGIN
    IF NOT authz.current_context_allows(p_tenant_id, 'submission.write', 'submission.attempts') THEN
        RAISE EXCEPTION 'signed authorization context does not allow reading the proctor policy'
            USING ERRCODE = '42501';
    END IF;
    RETURN (
        SELECT projection.proctor_policy
        FROM submission.attempts AS attempt
        JOIN submission.assignment_projections AS projection
          ON projection.tenant_id = attempt.tenant_id
         AND projection.candidate_assignment_id = attempt.candidate_assignment_id
        WHERE attempt.tenant_id = p_tenant_id AND attempt.id = p_attempt_id
    );
END
$function$;

REVOKE ALL ON FUNCTION submission.set_assignment_proctor_policy(uuid, uuid, bigint, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION submission.get_attempt_proctor_policy(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submission.set_assignment_proctor_policy(uuid, uuid, bigint, jsonb) TO aether_submission_projection_worker;
GRANT EXECUTE ON FUNCTION submission.get_attempt_proctor_policy(uuid, uuid) TO aether_submission_app;

RESET ROLE;
