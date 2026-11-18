SET ROLE aether_submission_owner;

DROP FUNCTION submission.proctor_grid(uuid, uuid, integer);

CREATE FUNCTION submission.proctor_grid(p_tenant_id uuid, p_exam_version_id uuid, p_limit integer DEFAULT 100)
RETURNS TABLE (
    attempt_id uuid, candidate_id uuid, started_at timestamptz,
    snapshot_id uuid, captured_at timestamptz, storage_key text,
    violation_total integer, violation_kinds jsonb, max_violations integer
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, authz, submission
AS $function$
BEGIN
    IF NOT authz.current_context_allows(p_tenant_id, 'submission.read', 'submission.proctor_evidence') THEN
        RAISE EXCEPTION 'signed authorization context does not allow reading the proctor grid'
            USING ERRCODE = '42501';
    END IF;
    IF p_exam_version_id IS NULL OR p_limit IS NULL OR p_limit < 1 THEN
        RAISE EXCEPTION 'grid fields are invalid' USING ERRCODE = '22023';
    END IF;
    RETURN QUERY
    SELECT attempt.id, attempt.candidate_id, attempt.started_at,
           snapshot.id, snapshot.captured_at, snapshot.storage_key,
           COALESCE(counts.total, 0), COALESCE(counts.kinds, '{}'::jsonb),
           CASE WHEN pg_catalog.jsonb_typeof(projection.proctor_policy -> 'max_violations') = 'number'
                THEN (projection.proctor_policy ->> 'max_violations')::integer END
    FROM submission.attempts AS attempt
    LEFT JOIN submission.assignment_projections AS projection
      ON projection.tenant_id = attempt.tenant_id
     AND projection.candidate_assignment_id = attempt.candidate_assignment_id
    LEFT JOIN LATERAL (
        SELECT s.id, s.captured_at, s.storage_key
        FROM submission.attempt_snapshots AS s
        WHERE s.tenant_id = attempt.tenant_id AND s.attempt_id = attempt.id
        ORDER BY s.captured_at DESC LIMIT 1
    ) AS snapshot ON true
    LEFT JOIN LATERAL (
        SELECT sum(c.count)::integer AS total, jsonb_object_agg(c.kind, c.count) AS kinds
        FROM submission.attempt_violation_counts AS c
        WHERE c.tenant_id = attempt.tenant_id AND c.attempt_id = attempt.id
    ) AS counts ON true
    WHERE attempt.tenant_id = p_tenant_id
      AND attempt.exam_version_id = p_exam_version_id
      AND attempt.lifecycle_state = 'active'
      AND attempt.deleted_at IS NULL
    ORDER BY COALESCE(counts.total, 0) DESC, attempt.started_at, attempt.id
    LIMIT LEAST(p_limit, 200);
END
$function$;

REVOKE ALL ON FUNCTION submission.proctor_grid(uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submission.proctor_grid(uuid, uuid, integer) TO aether_submission_app;

RESET ROLE;
