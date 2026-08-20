-- Candidate-facing assignment collection. Assessment RLS is tenant-scoped, so
-- ownership is bound here to authz.current_context_actor_id() rather than in Go.
SET ROLE aether_assessment_owner;

DROP INDEX IF EXISTS assessment.candidate_assignments_candidate_idx;
CREATE INDEX candidate_assignments_candidate_idx
    ON assessment.candidate_assignments (tenant_id, candidate_id, available_from DESC, id DESC);

CREATE FUNCTION assessment.list_candidate_assignments(
    p_tenant_id uuid,
    p_limit integer,
    p_cursor_available_from timestamptz,
    p_cursor_id uuid,
    p_lifecycle_state text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, assessment, authz
AS $function$
DECLARE
    signed_actor_id uuid;
    response jsonb;
BEGIN
    signed_actor_id := authz.current_context_actor_id();
    IF signed_actor_id IS NULL THEN
        RAISE EXCEPTION 'current authorization context has no actor' USING ERRCODE = '42501';
    END IF;
    -- 101 accommodates the caller's limit+1 probe for next-page detection.
    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 101 THEN
        RAISE EXCEPTION 'assignment listing limit must be between 1 and 100' USING ERRCODE = '22023';
    END IF;
    IF (p_cursor_available_from IS NULL) <> (p_cursor_id IS NULL) THEN
        RAISE EXCEPTION 'assignment listing cursor must supply both parts' USING ERRCODE = '22023';
    END IF;

    SELECT COALESCE(jsonb_agg(row_to_json(item)::jsonb ORDER BY item.available_from DESC, item.id DESC), '[]'::jsonb)
    INTO response
    FROM (
        SELECT assignment.id,
               assignment.tenant_id,
               assignment.assignment_rule_id,
               assignment.exam_version_id,
               assignment.candidate_id,
               assignment.available_from,
               assignment.available_until,
               assignment.lifecycle_state,
               assignment.assigned_at,
               assignment.revoked_at,
               assignment.completed_at,
               assignment.version
        FROM assessment.candidate_assignments AS assignment
        WHERE assignment.tenant_id = p_tenant_id
          AND assignment.candidate_id = signed_actor_id
          AND assignment.deleted_at IS NULL
          AND (p_lifecycle_state IS NULL OR assignment.lifecycle_state = p_lifecycle_state)
          AND (
                p_cursor_available_from IS NULL
                OR (assignment.available_from, assignment.id) < (p_cursor_available_from, p_cursor_id)
              )
        ORDER BY assignment.available_from DESC, assignment.id DESC
        LIMIT p_limit
    ) AS item;

    RETURN response;
END
$function$;

REVOKE ALL ON FUNCTION assessment.list_candidate_assignments(uuid, integer, timestamptz, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assessment.list_candidate_assignments(uuid, integer, timestamptz, uuid, text)
    TO aether_assessment_app;

RESET ROLE;
