-- Candidate-facing attempt collections. Row ownership is enforced here, not in
-- Go: submission RLS policies are tenant-scoped, so a plain SELECT over
-- submission.attempts would expose every candidate in the college. Binding to
-- authz.current_context_actor_id() inside a SECURITY DEFINER function makes the
-- ownership predicate impossible for a caller to omit.
SET ROLE aether_submission_owner;

-- Keyset pagination compares (created_at, id); without the trailing id the
-- existing index cannot satisfy the tiebreak.
DROP INDEX IF EXISTS submission.attempts_candidate_idx;
CREATE INDEX attempts_candidate_idx
    ON submission.attempts (tenant_id, candidate_id, created_at DESC, id DESC);

CREATE FUNCTION submission.list_attempts(
    p_tenant_id uuid,
    p_limit integer,
    p_cursor_created_at timestamptz,
    p_cursor_id uuid,
    p_exam_version_id uuid,
    p_lifecycle_state text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, submission, authz
AS $function$
DECLARE
    signed_actor_id uuid;
    response jsonb;
BEGIN
    signed_actor_id := authz.current_context_actor_id();
    IF signed_actor_id IS NULL THEN
        RAISE EXCEPTION 'current authorization context has no actor' USING ERRCODE = '42501';
    END IF;
    -- 101 accommodates the caller's limit+1 probe for next-page detection: the
    -- handler rejects a client limit above 100, then asks for one extra row.
    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 101 THEN
        RAISE EXCEPTION 'attempt listing limit must be between 1 and 100' USING ERRCODE = '22023';
    END IF;
    IF (p_cursor_created_at IS NULL) <> (p_cursor_id IS NULL) THEN
        RAISE EXCEPTION 'attempt listing cursor must supply both parts' USING ERRCODE = '22023';
    END IF;

    SELECT COALESCE(jsonb_agg(row_to_json(item)::jsonb ORDER BY item.created_at DESC, item.id DESC), '[]'::jsonb)
    INTO response
    FROM (
        SELECT attempt.id,
               attempt.tenant_id,
               attempt.exam_id,
               attempt.exam_version_id,
               attempt.candidate_id,
               attempt.candidate_assignment_id,
               attempt.attempt_number,
               attempt.lifecycle_state,
               attempt.available_from,
               attempt.submission_deadline,
               attempt.started_at,
               attempt.submitted_at,
               attempt.completed_at,
               attempt.created_at,
               attempt.legal_hold,
               attempt.version
        FROM submission.attempts AS attempt
        WHERE attempt.tenant_id = p_tenant_id
          AND attempt.candidate_id = signed_actor_id
          AND attempt.deleted_at IS NULL
          AND (p_exam_version_id IS NULL OR attempt.exam_version_id = p_exam_version_id)
          AND (p_lifecycle_state IS NULL OR attempt.lifecycle_state = p_lifecycle_state)
          AND (
                p_cursor_created_at IS NULL
                OR (attempt.created_at, attempt.id) < (p_cursor_created_at, p_cursor_id)
              )
        ORDER BY attempt.created_at DESC, attempt.id DESC
        LIMIT p_limit
    ) AS item;

    RETURN response;
END
$function$;

CREATE FUNCTION submission.list_answer_revisions(
    p_tenant_id uuid,
    p_attempt_id uuid,
    p_limit integer,
    p_cursor_created_at timestamptz,
    p_cursor_id uuid,
    p_exam_item_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, submission, authz
AS $function$
DECLARE
    signed_actor_id uuid;
    owns_attempt boolean;
    response jsonb;
BEGIN
    signed_actor_id := authz.current_context_actor_id();
    IF signed_actor_id IS NULL THEN
        RAISE EXCEPTION 'current authorization context has no actor' USING ERRCODE = '42501';
    END IF;
    -- 101 accommodates the caller's limit+1 probe for next-page detection.
    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 101 THEN
        RAISE EXCEPTION 'answer listing limit must be between 1 and 100' USING ERRCODE = '22023';
    END IF;
    IF (p_cursor_created_at IS NULL) <> (p_cursor_id IS NULL) THEN
        RAISE EXCEPTION 'answer listing cursor must supply both parts' USING ERRCODE = '22023';
    END IF;

    -- Ownership is proven against the parent attempt, so an opaque attempt UUID
    -- belonging to another candidate yields not-found rather than their answers.
    SELECT true INTO owns_attempt
    FROM submission.attempts AS attempt
    WHERE attempt.tenant_id = p_tenant_id
      AND attempt.id = p_attempt_id
      AND attempt.candidate_id = signed_actor_id
      AND attempt.deleted_at IS NULL;
    IF owns_attempt IS NOT TRUE THEN
        RAISE EXCEPTION 'attempt was not found' USING ERRCODE = 'no_data_found';
    END IF;

    SELECT COALESCE(jsonb_agg(row_to_json(item)::jsonb ORDER BY item.created_at DESC, item.id DESC), '[]'::jsonb)
    INTO response
    FROM (
        -- encryption_key_reference is deliberately excluded: a KMS key
        -- reference has no place in a list response, for the same reason
        -- seb.list_sessions omits quit_token_hash. The remaining fields match
        -- app.AnswerRevision's JSON tags exactly.
        SELECT revision.id,
               revision.tenant_id,
               revision.attempt_id,
               revision.exam_item_id,
               revision.revision_number,
               revision.language_id,
               revision.source_object_key,
               revision.source_checksum,
               revision.created_at
        FROM submission.answer_revisions AS revision
        WHERE revision.tenant_id = p_tenant_id
          AND revision.attempt_id = p_attempt_id
          AND (p_exam_item_id IS NULL OR revision.exam_item_id = p_exam_item_id)
          AND (
                p_cursor_created_at IS NULL
                OR (revision.created_at, revision.id) < (p_cursor_created_at, p_cursor_id)
              )
        ORDER BY revision.created_at DESC, revision.id DESC
        LIMIT p_limit
    ) AS item;

    RETURN response;
END
$function$;

REVOKE ALL ON FUNCTION submission.list_attempts(uuid, integer, timestamptz, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION submission.list_answer_revisions(uuid, uuid, integer, timestamptz, uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
    submission.list_attempts(uuid, integer, timestamptz, uuid, uuid, text),
    submission.list_answer_revisions(uuid, uuid, integer, timestamptz, uuid, uuid)
    TO aether_submission_app;

RESET ROLE;
