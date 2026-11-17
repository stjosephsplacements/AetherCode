-- Live proctor grid (ADR-0081). The proctor service reports each stored violation
-- as an event; Submission keeps a per-attempt count so the invigilator grid reads
-- one database. The grid read is student PII, so it needs the proctor_evidence
-- resource that ADR-0080 maps to VIEW_STUDENT_PII.
SET ROLE aether_submission_owner;

CREATE TABLE submission.attempt_violation_counts (
    tenant_id uuid NOT NULL,
    attempt_id uuid NOT NULL,
    kind text NOT NULL CHECK (length(kind) BETWEEN 1 AND 64),
    count integer NOT NULL CHECK (count > 0),
    last_at timestamptz NOT NULL,
    PRIMARY KEY (tenant_id, attempt_id, kind)
);

ALTER TABLE submission.attempt_violation_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission.attempt_violation_counts FORCE ROW LEVEL SECURITY;
CREATE POLICY attempt_violation_counts_owner ON submission.attempt_violation_counts
    FOR ALL TO aether_submission_owner USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE submission.attempt_violation_counts FROM PUBLIC;

-- Called by the projection consumer inside its inbox transaction, so a redelivered
-- event is counted once.
CREATE FUNCTION submission.record_attempt_violation(
    p_tenant_id uuid, p_attempt_id uuid, p_kind text, p_detected_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, submission
AS $function$
BEGIN
    IF p_tenant_id IS NULL OR p_attempt_id IS NULL OR p_detected_at IS NULL
       OR p_kind IS NULL OR pg_catalog.length(p_kind) NOT BETWEEN 1 AND 64 THEN
        RAISE EXCEPTION 'violation fields are invalid' USING ERRCODE = '22023';
    END IF;
    INSERT INTO submission.attempt_violation_counts AS counts (tenant_id, attempt_id, kind, count, last_at)
    VALUES (p_tenant_id, p_attempt_id, p_kind, 1, p_detected_at)
    ON CONFLICT (tenant_id, attempt_id, kind) DO UPDATE
    SET count = counts.count + 1, last_at = GREATEST(counts.last_at, EXCLUDED.last_at);
END
$function$;

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

REVOKE ALL ON FUNCTION submission.record_attempt_violation(uuid, uuid, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION submission.proctor_grid(uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submission.record_attempt_violation(uuid, uuid, text, timestamptz) TO aether_submission_projection_worker;
GRANT EXECUTE ON FUNCTION submission.proctor_grid(uuid, uuid, integer) TO aether_submission_app;

RESET ROLE;
