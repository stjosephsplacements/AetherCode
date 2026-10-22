-- Exam-day operations for staff (ADR-0027).
-- * Result release: candidates see their score only after staff release it.
-- * Extra time: staff move the deadline of one in-progress attempt, or of
--   every in-progress attempt of an exam version. The attempt version is not
--   bumped, so the candidate's open exam screen keeps saving.
-- * Announcements: staff post short messages that every candidate of the exam
--   version sees on the exam screen.
-- * Live monitor: one row per assigned candidate with their latest attempt
--   and its best-so-far score.
-- Staff functions authorize on score_summaries (read, release) and
-- attempt_events (extra time, announcements). Policy never grants either to a
-- candidate's self scope, so a student cannot obtain these capabilities.
SET ROLE aether_submission_owner;

CREATE TABLE submission.exam_operations (
    tenant_id uuid NOT NULL,
    exam_version_id uuid NOT NULL,
    results_released_at timestamptz,
    updated_by uuid NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (tenant_id, exam_version_id)
);

CREATE TABLE submission.exam_announcements (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    exam_version_id uuid NOT NULL,
    body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
    created_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX exam_announcements_version_idx
    ON submission.exam_announcements (tenant_id, exam_version_id, created_at DESC);

-- No direct grants: the app reaches both tables only through the functions
-- below.
ALTER TABLE submission.exam_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission.exam_operations FORCE ROW LEVEL SECURITY;
ALTER TABLE submission.exam_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission.exam_announcements FORCE ROW LEVEL SECURITY;
CREATE POLICY submission_exam_operations_owner_maintenance ON submission.exam_operations
    FOR ALL TO aether_submission_owner USING (true) WITH CHECK (true);
CREATE POLICY submission_exam_announcements_owner_maintenance ON submission.exam_announcements
    FOR ALL TO aether_submission_owner USING (true) WITH CHECK (true);

-- The best evaluation of each item of an attempt, as graded (ADR-0025).
CREATE FUNCTION submission.attempt_item_scores(p_tenant_id uuid, p_attempt_id uuid)
RETURNS TABLE (exam_item_id uuid, score numeric, maximum_score numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, submission
AS $function$
    SELECT revision.exam_item_id,
           max(submission.evaluation_score(p_tenant_id, request_row.id)),
           max(request_row.maximum_score)
    FROM submission.evaluation_requests AS request_row
    JOIN submission.answer_revisions AS revision
      ON revision.tenant_id = request_row.tenant_id
     AND revision.id = request_row.answer_revision_id
    WHERE request_row.tenant_id = p_tenant_id
      AND request_row.attempt_id = p_attempt_id
    GROUP BY revision.exam_item_id
$function$;

CREATE FUNCTION submission.get_exam_monitor(p_tenant_id uuid, p_exam_version_id uuid)
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
                       'maximum_score', summary.maximum_score
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

CREATE FUNCTION submission.set_exam_results_release(
    p_tenant_id uuid,
    p_exam_version_id uuid,
    p_released boolean
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz, submission
AS $function$
DECLARE
    actor_id uuid;
    released_at timestamptz;
BEGIN
    PERFORM submission.require_authorized_context(p_tenant_id, 'submission.write', 'submission.score_summaries');
    actor_id := authz.current_context_actor_id();
    IF actor_id IS NULL OR p_exam_version_id IS NULL OR p_released IS NULL THEN
        RAISE EXCEPTION 'result release command is invalid';
    END IF;
    INSERT INTO submission.exam_operations AS operation (tenant_id, exam_version_id, results_released_at, updated_by)
    VALUES (p_tenant_id, p_exam_version_id, CASE WHEN p_released THEN clock_timestamp() END, actor_id)
    ON CONFLICT (tenant_id, exam_version_id) DO UPDATE
    SET results_released_at = CASE WHEN p_released
                                   THEN COALESCE(operation.results_released_at, clock_timestamp()) END,
        updated_by = EXCLUDED.updated_by,
        updated_at = clock_timestamp()
    RETURNING operation.results_released_at INTO released_at;
    RETURN released_at;
END
$function$;

-- Adds p_seconds to the deadline of in-progress attempts of the exam version:
-- the one named, or all of them when p_attempt_id is null. An attempt counts
-- as in progress while it is active and still within its answer grace, so an
-- attempt the expiry worker is about to close is not reopened.
CREATE FUNCTION submission.extend_attempt_deadlines(
    p_tenant_id uuid,
    p_exam_version_id uuid,
    p_attempt_id uuid,
    p_seconds integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz, submission
AS $function$
DECLARE
    actor_id uuid;
    extended integer;
BEGIN
    PERFORM submission.require_authorized_context(p_tenant_id, 'submission.write', 'submission.attempt_events');
    actor_id := authz.current_context_actor_id();
    IF actor_id IS NULL OR p_exam_version_id IS NULL OR p_seconds IS NULL
       OR p_seconds NOT BETWEEN 60 AND 14400 THEN
        RAISE EXCEPTION 'extra time must be between 1 minute and 4 hours';
    END IF;

    WITH moved AS (
        UPDATE submission.attempts AS attempt
        SET submission_deadline = attempt.submission_deadline + make_interval(secs => p_seconds)
        WHERE attempt.tenant_id = p_tenant_id
          AND attempt.exam_version_id = p_exam_version_id
          AND (p_attempt_id IS NULL OR attempt.id = p_attempt_id)
          AND attempt.lifecycle_state = 'active'
          AND attempt.deleted_at IS NULL
          AND clock_timestamp() < attempt.submission_deadline + submission.answer_grace()
        RETURNING attempt.id, attempt.submission_deadline
    ), logged AS (
        INSERT INTO submission.attempt_events (id, tenant_id, attempt_id, actor_id, event_type, payload)
        SELECT pg_catalog.uuidv7(), p_tenant_id, moved.id, actor_id, 'submission.attempt.deadline_extended.v1',
               jsonb_build_object('attempt_id', moved.id, 'seconds', p_seconds,
                                  'submission_deadline', moved.submission_deadline)
        FROM moved
        RETURNING 1
    )
    SELECT count(*) INTO extended FROM logged;

    IF p_attempt_id IS NOT NULL AND extended = 0 THEN
        RAISE EXCEPTION 'the attempt is not in progress' USING ERRCODE = '55000',
            DETAIL = 'candidate: This attempt has already ended, so its time cannot be extended.';
    END IF;
    RETURN extended;
END
$function$;

CREATE FUNCTION submission.post_exam_announcement(
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

-- What an open exam screen polls: the current deadline (staff may have
-- extended it), the state, and the exam's announcements.
CREATE FUNCTION submission.get_attempt_live_state_for_candidate(p_tenant_id uuid, p_attempt_id uuid)
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
        'announcements', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', note.id, 'body', note.body, 'created_at', note.created_at)
                             ORDER BY note.created_at DESC)
            FROM submission.exam_announcements AS note
            WHERE note.tenant_id = p_tenant_id AND note.exam_version_id = attempt_record.exam_version_id
        ), '[]'::jsonb)
    );
END
$function$;

-- A candidate's score, only once staff have released the exam's results and
-- the attempt is graded. Hidden tests stay hidden: the result is per question.
CREATE FUNCTION submission.get_attempt_result_for_candidate(p_tenant_id uuid, p_attempt_id uuid)
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

REVOKE ALL ON FUNCTION submission.attempt_item_scores(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION submission.get_exam_monitor(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION submission.set_exam_results_release(uuid, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION submission.extend_attempt_deadlines(uuid, uuid, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION submission.post_exam_announcement(uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION submission.get_attempt_live_state_for_candidate(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION submission.get_attempt_result_for_candidate(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submission.get_exam_monitor(uuid, uuid) TO aether_submission_app;
GRANT EXECUTE ON FUNCTION submission.set_exam_results_release(uuid, uuid, boolean) TO aether_submission_app;
GRANT EXECUTE ON FUNCTION submission.extend_attempt_deadlines(uuid, uuid, uuid, integer) TO aether_submission_app;
GRANT EXECUTE ON FUNCTION submission.post_exam_announcement(uuid, uuid, uuid, text) TO aether_submission_app;
GRANT EXECUTE ON FUNCTION submission.get_attempt_live_state_for_candidate(uuid, uuid) TO aether_submission_app;
GRANT EXECUTE ON FUNCTION submission.get_attempt_result_for_candidate(uuid, uuid) TO aether_submission_app;

RESET ROLE;
