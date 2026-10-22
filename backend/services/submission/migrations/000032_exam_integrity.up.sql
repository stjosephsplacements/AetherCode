-- Exam integrity (ADR-0037), as in the exam app. Per exam version, staff may
-- require fullscreen and block pasting text from outside the exam. The exam
-- screen reports leaving the window, leaving fullscreen and blocked pastes;
-- each is an attempt event the monitor counts and the attempt review lists.
SET ROLE aether_submission_owner;

ALTER TABLE submission.exam_operations
    ADD COLUMN require_fullscreen boolean NOT NULL DEFAULT false,
    ADD COLUMN block_external_paste boolean NOT NULL DEFAULT false;

CREATE FUNCTION submission.set_exam_integrity(
    p_tenant_id uuid, p_exam_version_id uuid, p_require_fullscreen boolean, p_block_external_paste boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz, submission
AS $function$
DECLARE
    actor_id uuid;
BEGIN
    PERFORM submission.require_authorized_context(p_tenant_id, 'submission.write', 'submission.attempt_events');
    actor_id := authz.current_context_actor_id();
    IF actor_id IS NULL OR p_exam_version_id IS NULL OR p_require_fullscreen IS NULL OR p_block_external_paste IS NULL THEN
        RAISE EXCEPTION 'exam integrity command is invalid';
    END IF;
    INSERT INTO submission.exam_operations AS operation (tenant_id, exam_version_id, updated_by, require_fullscreen, block_external_paste)
    VALUES (p_tenant_id, p_exam_version_id, actor_id, p_require_fullscreen, p_block_external_paste)
    ON CONFLICT (tenant_id, exam_version_id) DO UPDATE
    SET require_fullscreen = EXCLUDED.require_fullscreen, block_external_paste = EXCLUDED.block_external_paste,
        updated_by = EXCLUDED.updated_by, updated_at = clock_timestamp();
END
$function$;

-- Records one integrity event for the candidate's own open attempt. At most
-- 1000 per attempt, so a looping client cannot fill the log.
CREATE FUNCTION submission.record_integrity_event(p_tenant_id uuid, p_attempt_id uuid, p_kind text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz, submission
AS $function$
DECLARE
    attempt_record submission.attempts%ROWTYPE;
BEGIN
    PERFORM submission.require_authorized_context(p_tenant_id, 'submission.write', 'submission.attempts');
    IF p_kind NOT IN ('blur', 'paste', 'fullscreen_exit') THEN
        RAISE EXCEPTION 'unknown integrity event' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO attempt_record FROM submission.attempts
    WHERE tenant_id = p_tenant_id AND id = p_attempt_id AND deleted_at IS NULL;
    IF NOT FOUND OR attempt_record.candidate_id <> authz.current_context_actor_id() THEN
        RAISE EXCEPTION 'candidate attempt was not found' USING ERRCODE = 'P0001';
    END IF;
    IF attempt_record.lifecycle_state <> 'active' THEN
        RETURN;
    END IF;
    IF (SELECT count(*) FROM submission.attempt_events AS event
        WHERE event.tenant_id = p_tenant_id AND event.attempt_id = p_attempt_id
          AND event.event_type = 'submission.attempt.integrity.v1') >= 1000 THEN
        RETURN;
    END IF;
    INSERT INTO submission.attempt_events (id, tenant_id, attempt_id, actor_id, event_type, payload)
    VALUES (pg_catalog.uuidv7(), p_tenant_id, p_attempt_id, attempt_record.candidate_id,
            'submission.attempt.integrity.v1', jsonb_build_object('kind', p_kind));
END
$function$;

REVOKE ALL ON FUNCTION submission.set_exam_integrity(uuid, uuid, boolean, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION submission.record_integrity_event(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submission.set_exam_integrity(uuid, uuid, boolean, boolean) TO aether_submission_app;
GRANT EXECUTE ON FUNCTION submission.record_integrity_event(uuid, uuid, text) TO aether_submission_app;

CREATE OR REPLACE FUNCTION submission.get_attempt_live_state_for_candidate(p_tenant_id uuid, p_attempt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, authz, submission
AS $function$
DECLARE
    attempt_record submission.attempts%ROWTYPE;
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
    RETURN jsonb_build_object(
        'lifecycle_state', attempt_record.lifecycle_state,
        'submission_deadline', attempt_record.submission_deadline,
        'require_fullscreen', COALESCE((SELECT operation.require_fullscreen FROM submission.exam_operations AS operation
            WHERE operation.tenant_id = p_tenant_id AND operation.exam_version_id = attempt_record.exam_version_id), false),
        'block_external_paste', COALESCE((SELECT operation.block_external_paste FROM submission.exam_operations AS operation
            WHERE operation.tenant_id = p_tenant_id AND operation.exam_version_id = attempt_record.exam_version_id), false),
        'announcements', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', note.id, 'body', note.body, 'created_at', note.created_at)
                             ORDER BY note.created_at DESC)
            FROM submission.exam_announcements AS note
            WHERE note.tenant_id = p_tenant_id AND note.exam_version_id = attempt_record.exam_version_id
        ), '[]'::jsonb)
    );
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
