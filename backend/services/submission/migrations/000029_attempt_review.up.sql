-- Staff review of one attempt (ADR-0029): the student's latest code for each
-- question, every evaluation with per-verdict counts, and the attempt's event
-- log (start, saves are not logged, submits, extra time, hand-in, grading).
-- It authorizes on judge_receipts, the reviewer resource no candidate self
-- scope can obtain, and returns storage references that the service
-- decrypts; they never reach the browser.
SET ROLE aether_submission_owner;

CREATE FUNCTION submission.get_attempt_review(p_tenant_id uuid, p_attempt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, authz, submission
AS $function$
DECLARE
    attempt_row submission.attempts%ROWTYPE;
    assignment_row submission.assignment_projections%ROWTYPE;
BEGIN
    IF p_tenant_id IS NULL OR NOT authz.current_context_allows_read(
        p_tenant_id, 'submission.read', 'submission.write', 'submission.judge_receipts'
    ) THEN
        RAISE EXCEPTION 'signed authorization context does not allow this submission operation'
            USING ERRCODE = '42501';
    END IF;
    SELECT * INTO attempt_row FROM submission.attempts AS attempt
    WHERE attempt.tenant_id = p_tenant_id AND attempt.id = p_attempt_id AND attempt.deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'attempt was not found' USING ERRCODE = 'P0001';
    END IF;
    SELECT * INTO assignment_row FROM submission.assignment_projections
    WHERE tenant_id = p_tenant_id AND candidate_assignment_id = attempt_row.candidate_assignment_id;

    RETURN jsonb_build_object(
        'attempt', jsonb_build_object(
            'id', attempt_row.id,
            'exam_id', attempt_row.exam_id,
            'exam_version_id', attempt_row.exam_version_id,
            'candidate_id', attempt_row.candidate_id,
            'attempt_number', attempt_row.attempt_number,
            'lifecycle_state', attempt_row.lifecycle_state,
            'started_at', attempt_row.started_at,
            'submission_deadline', attempt_row.submission_deadline,
            'submitted_at', attempt_row.submitted_at,
            'completed_at', attempt_row.completed_at,
            'title', assignment_row.title
        ),
        'score', (
            SELECT jsonb_build_object('score', summary.score::text, 'maximum_score', summary.maximum_score::text)
            FROM submission.score_summaries AS summary
            WHERE summary.tenant_id = p_tenant_id AND summary.attempt_id = p_attempt_id AND summary.lifecycle_state = 'finalized'
        ),
        'items', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                       'exam_item_id', item.exam_item_id,
                       'position', item.position,
                       'title', item.title,
                       'maximum_score', item.maximum_score::text,
                       'best_score', (
                           SELECT scored.score::text FROM submission.attempt_item_scores(p_tenant_id, p_attempt_id) AS scored
                           WHERE scored.exam_item_id = item.exam_item_id
                       ),
                       'latest_answer', CASE WHEN latest.id IS NULL THEN NULL ELSE jsonb_build_object(
                           'language', latest.language_id,
                           'revision_number', latest.revision_number,
                           'saved_at', latest.created_at,
                           'source_object_key', latest.source_object_key,
                           'source_checksum', lower(latest.source_checksum::text),
                           'encryption_key_reference', latest.encryption_key_reference
                       ) END,
                       'evaluations', COALESCE((
                           SELECT jsonb_agg(jsonb_build_object(
                                      'origin', request_row.origin,
                                      'lifecycle_state', request_row.lifecycle_state,
                                      'language', revision.language_id,
                                      'revision_number', revision.revision_number,
                                      'queued_at', request_row.queued_at,
                                      'verdict', receipt.verdict,
                                      'score', CASE WHEN receipt.id IS NULL THEN NULL
                                                    ELSE submission.evaluation_score(p_tenant_id, request_row.id)::text END,
                                      'verdict_counts', COALESCE((
                                          SELECT jsonb_object_agg(counted.verdict, counted.total)
                                          FROM (SELECT unit.verdict, count(*) AS total
                                                FROM submission.judge_receipt_units AS unit
                                                WHERE unit.tenant_id = receipt.tenant_id AND unit.judge_receipt_id = receipt.id
                                                GROUP BY unit.verdict) AS counted
                                      ), '{}'::jsonb)
                                  ) ORDER BY request_row.queued_at DESC)
                           FROM submission.evaluation_requests AS request_row
                           JOIN submission.answer_revisions AS revision
                             ON revision.tenant_id = request_row.tenant_id AND revision.id = request_row.answer_revision_id
                           LEFT JOIN LATERAL (
                               SELECT * FROM submission.judge_receipts AS candidate_receipt
                               WHERE candidate_receipt.tenant_id = request_row.tenant_id
                                 AND candidate_receipt.evaluation_request_id = request_row.id
                               ORDER BY candidate_receipt.received_at DESC LIMIT 1
                           ) AS receipt ON true
                           WHERE request_row.tenant_id = p_tenant_id AND request_row.attempt_id = p_attempt_id
                             AND revision.exam_item_id = item.exam_item_id
                       ), '[]'::jsonb)
                   ) ORDER BY item.position NULLS LAST, item.exam_item_id)
            FROM submission.assignment_item_projections AS item
            LEFT JOIN LATERAL (
                SELECT revision.* FROM submission.answer_revisions AS revision
                WHERE revision.tenant_id = p_tenant_id AND revision.attempt_id = p_attempt_id
                  AND revision.exam_item_id = item.exam_item_id
                ORDER BY revision.revision_number DESC LIMIT 1
            ) AS latest ON true
            WHERE item.tenant_id = p_tenant_id AND item.candidate_assignment_id = attempt_row.candidate_assignment_id
        ), '[]'::jsonb),
        'events', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                       'occurred_at', event.occurred_at,
                       'event_type', event.event_type,
                       'actor_id', event.actor_id,
                       'payload', event.payload
                   ) ORDER BY event.occurred_at, event.id)
            FROM submission.attempt_events AS event
            WHERE event.tenant_id = p_tenant_id AND event.attempt_id = p_attempt_id
        ), '[]'::jsonb)
    );
END
$function$;

REVOKE ALL ON FUNCTION submission.get_attempt_review(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submission.get_attempt_review(uuid, uuid) TO aether_submission_app;

RESET ROLE;
