SET ROLE aether_submission_owner;

CREATE OR REPLACE FUNCTION submission.get_attempt_result_for_candidate(p_tenant_id uuid, p_attempt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, authz, submission
AS $function$
DECLARE
    attempt_record submission.attempts%ROWTYPE;
    released_at timestamptz;
    summary submission.score_summaries%ROWTYPE;
BEGIN
    IF NOT authz.current_context_allows_read(
        p_tenant_id, 'submission.read', 'submission.write', 'submission.attempts'
    ) THEN
        RAISE EXCEPTION 'signed authorization context does not allow this submission operation'
            USING ERRCODE = '42501';
    END IF;
    SELECT * INTO attempt_record FROM submission.attempts AS attempt
    WHERE attempt.tenant_id = p_tenant_id AND attempt.id = p_attempt_id
      AND attempt.candidate_id = authz.current_context_actor_id() AND attempt.deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'candidate attempt was not found' USING ERRCODE = 'P0001';
    END IF;
    SELECT operation.results_released_at INTO released_at FROM submission.exam_operations AS operation
    WHERE operation.tenant_id = p_tenant_id AND operation.exam_version_id = attempt_record.exam_version_id;
    SELECT * INTO summary FROM submission.score_summaries AS score_row
    WHERE score_row.tenant_id = p_tenant_id AND score_row.attempt_id = p_attempt_id
      AND score_row.lifecycle_state = 'finalized';
    IF released_at IS NULL OR summary.id IS NULL THEN
        RETURN jsonb_build_object('released', false);
    END IF;
    RETURN jsonb_build_object(
        'released', true,
        'released_at', released_at,
        'score', summary.score,
        'maximum_score', summary.maximum_score,
        'items', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                       'exam_item_id', item.exam_item_id,
                       'position', item.position,
                       'title', item.title,
                       'score', COALESCE(scored.score, 0),
                       'maximum_score', item.maximum_score
                   ) ORDER BY item.position NULLS LAST, item.exam_item_id)
            FROM submission.assignment_item_projections AS item
            LEFT JOIN submission.attempt_item_scores(p_tenant_id, p_attempt_id) AS scored
              ON scored.exam_item_id = item.exam_item_id
            WHERE item.tenant_id = p_tenant_id
              AND item.candidate_assignment_id = attempt_record.candidate_assignment_id
        ), '[]'::jsonb)
    );
END
$function$;

RESET ROLE;
