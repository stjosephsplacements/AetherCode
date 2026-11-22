-- Strip created_by from staff announcement JSON (bodies from 000028 / 000038).
SET ROLE aether_submission_owner;

CREATE OR REPLACE FUNCTION submission.post_exam_announcement(
    p_id uuid,
    p_tenant_id uuid,
    p_exam_version_id uuid,
    p_body text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz, submission
AS $function$
DECLARE
    actor_id uuid;
    note submission.exam_announcements%ROWTYPE;
BEGIN
    PERFORM submission.require_authorized_context(p_tenant_id, 'submission.write', 'submission.attempt_events');
    actor_id := authz.current_context_actor_id();
    IF actor_id IS NULL OR p_id IS NULL OR p_exam_version_id IS NULL
       OR p_body IS NULL OR length(btrim(p_body)) NOT BETWEEN 1 AND 2000 THEN
        RAISE EXCEPTION 'an announcement needs 1 to 2000 characters';
    END IF;
    INSERT INTO submission.exam_announcements (id, tenant_id, exam_version_id, body, created_by)
    VALUES (p_id, p_tenant_id, p_exam_version_id, btrim(p_body), actor_id)
    RETURNING * INTO note;
    RETURN jsonb_build_object('id', note.id, 'body', note.body, 'created_at', note.created_at);
END
$function$;

CREATE OR REPLACE FUNCTION submission.get_exam_monitor(p_tenant_id uuid, p_exam_version_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, authz, submission
AS $function$
DECLARE
    response jsonb;
BEGIN
    IF p_tenant_id IS NULL OR p_exam_version_id IS NULL OR NOT authz.current_context_allows_read(
        p_tenant_id, 'submission.read', 'submission.write', 'submission.score_summaries'
    ) THEN
        RAISE EXCEPTION 'signed authorization context does not allow this submission operation'
            USING ERRCODE = '42501';
    END IF;

    SELECT jsonb_build_object(
        'exam_version_id', p_exam_version_id,
        'require_fullscreen', COALESCE((SELECT operation.require_fullscreen FROM submission.exam_operations AS operation
            WHERE operation.tenant_id = p_tenant_id AND operation.exam_version_id = p_exam_version_id), false),
        'block_external_paste', COALESCE((SELECT operation.block_external_paste FROM submission.exam_operations AS operation
            WHERE operation.tenant_id = p_tenant_id AND operation.exam_version_id = p_exam_version_id), false),
        'webcam_required', COALESCE((SELECT operation.webcam_required FROM submission.exam_operations AS operation
            WHERE operation.tenant_id = p_tenant_id AND operation.exam_version_id = p_exam_version_id), false),
        'results_released_at', (
            SELECT operation.results_released_at FROM submission.exam_operations AS operation
            WHERE operation.tenant_id = p_tenant_id AND operation.exam_version_id = p_exam_version_id
        ),
        'announcements', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', note.id, 'body', note.body, 'created_at', note.created_at)
                             ORDER BY note.created_at DESC)
            FROM submission.exam_announcements AS note
            WHERE note.tenant_id = p_tenant_id AND note.exam_version_id = p_exam_version_id
        ), '[]'::jsonb),
        'candidates', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                       'candidate_id', assignment.candidate_id,
                       'attempt_id', attempt.id,
                       'lifecycle_state', attempt.lifecycle_state,
                       'started_at', attempt.started_at,
                       'submission_deadline', attempt.submission_deadline,
                       'submitted_at', attempt.submitted_at,
                       'items_answered', (
                           SELECT count(DISTINCT revision.exam_item_id)
                           FROM submission.answer_revisions AS revision
                           WHERE revision.tenant_id = p_tenant_id AND revision.attempt_id = attempt.id
                       ),
                       'score', COALESCE(summary.score, (
                           SELECT sum(item.score) FROM submission.attempt_item_scores(p_tenant_id, attempt.id) AS item
                       )),
                       'maximum_score', summary.maximum_score,
                       'flags', (
                           SELECT count(*) FROM submission.attempt_events AS event
                           WHERE event.tenant_id = p_tenant_id AND event.attempt_id = attempt.id
                             AND event.event_type = 'submission.attempt.integrity.v1'
                       )
                   ) ORDER BY attempt.started_at NULLS LAST, assignment.candidate_id)
            FROM submission.assignment_projections AS assignment
            LEFT JOIN LATERAL (
                SELECT * FROM submission.attempts AS candidate_attempt
                WHERE candidate_attempt.tenant_id = p_tenant_id
                  AND candidate_attempt.candidate_assignment_id = assignment.candidate_assignment_id
                  AND candidate_attempt.deleted_at IS NULL
                ORDER BY candidate_attempt.attempt_number DESC
                LIMIT 1
            ) AS attempt ON true
            LEFT JOIN submission.score_summaries AS summary
              ON summary.tenant_id = p_tenant_id AND summary.attempt_id = attempt.id
             AND summary.lifecycle_state = 'finalized'
            WHERE assignment.tenant_id = p_tenant_id
              AND assignment.exam_version_id = p_exam_version_id
              AND assignment.lifecycle_state = 'active'
        ), '[]'::jsonb)
    ) INTO response;
    RETURN response;
END
$function$;

RESET ROLE;
