-- Regrade (ADR-0039). After Assessment repins an exam item to corrected tests
-- (the projection then carries the new bundle), staff regrade it: every saved
-- answer of the item that was evaluated before is evaluated again on the new
-- bundle, and graded attempts go back to grading until those finish. Scoring
-- counts only evaluations on the item's current bundle.
SET ROLE aether_submission_owner;

ALTER TABLE submission.evaluation_requests
    DROP CONSTRAINT evaluation_requests_tenant_id_answer_revision_id_key,
    ADD CONSTRAINT evaluation_requests_revision_bundle_key UNIQUE (tenant_id, answer_revision_id, evaluation_bundle_checksum),
    DROP CONSTRAINT evaluation_requests_origin_check,
    ADD CONSTRAINT evaluation_requests_origin_check CHECK (origin IN ('final', 'item_submit', 'regrade'));

CREATE OR REPLACE FUNCTION submission.attempt_item_scores(p_tenant_id uuid, p_attempt_id uuid)
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
    JOIN submission.attempts AS scored_attempt
      ON scored_attempt.tenant_id = request_row.tenant_id AND scored_attempt.id = request_row.attempt_id
    LEFT JOIN submission.assignment_item_projections AS current_item
      ON current_item.tenant_id = scored_attempt.tenant_id
     AND current_item.candidate_assignment_id = scored_attempt.candidate_assignment_id
     AND current_item.exam_item_id = revision.exam_item_id
    WHERE request_row.tenant_id = p_tenant_id
      AND request_row.attempt_id = p_attempt_id
      -- Only evaluations on the item's current tests count: after a regrade the
      -- old ones are history (ADR-0039).
      AND (current_item.exam_item_id IS NULL
           OR request_row.evaluation_bundle_checksum = current_item.evaluation_bundle_checksum)
    GROUP BY revision.exam_item_id
    UNION ALL
    -- Multiple choice is all-or-nothing: the selection must equal the key.
    SELECT item.exam_item_id,
           CASE WHEN choice.selected IS NOT NULL
                     AND (SELECT array_agg(value ORDER BY value) FROM unnest(choice.selected) AS value)
                       = (SELECT array_agg(value ORDER BY value) FROM unnest(item.correct_choices) AS value)
                THEN item.maximum_score ELSE 0 END,
           item.maximum_score
    FROM submission.attempts AS attempt
    JOIN submission.assignment_item_projections AS item
      ON item.tenant_id = attempt.tenant_id AND item.candidate_assignment_id = attempt.candidate_assignment_id
     AND item.kind = 'mcq'
    JOIN submission.choice_answers AS choice
      ON choice.tenant_id = attempt.tenant_id AND choice.attempt_id = attempt.id AND choice.exam_item_id = item.exam_item_id
    WHERE attempt.tenant_id = p_tenant_id AND attempt.id = p_attempt_id
$function$;

CREATE FUNCTION submission.regrade_exam_item(p_tenant_id uuid, p_exam_version_id uuid, p_exam_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz, submission, extensions
AS $function$
DECLARE
    requested integer := 0;
    reopened integer := 0;
    candidate RECORD;
    request_id uuid;
    payload jsonb;
BEGIN
    PERFORM submission.require_authorized_context(p_tenant_id, 'submission.write', 'submission.score_summaries');
    IF p_exam_version_id IS NULL OR p_exam_item_id IS NULL THEN
        RAISE EXCEPTION 'regrade command is invalid';
    END IF;
    FOR candidate IN
        SELECT DISTINCT attempt.id AS attempt_id, attempt.lifecycle_state, revision.id AS revision_id,
               item.evaluation_bundle_object_key, item.evaluation_bundle_checksum, item.maximum_score
        FROM submission.attempts AS attempt
        JOIN submission.assignment_item_projections AS item
          ON item.tenant_id = attempt.tenant_id AND item.candidate_assignment_id = attempt.candidate_assignment_id
         AND item.exam_item_id = p_exam_item_id AND item.kind = 'coding'
        JOIN submission.evaluation_requests AS earlier
          ON earlier.tenant_id = attempt.tenant_id AND earlier.attempt_id = attempt.id
        JOIN submission.answer_revisions AS revision
          ON revision.tenant_id = earlier.tenant_id AND revision.id = earlier.answer_revision_id
         AND revision.exam_item_id = p_exam_item_id
        WHERE attempt.tenant_id = p_tenant_id AND attempt.exam_version_id = p_exam_version_id
          AND attempt.deleted_at IS NULL
          AND attempt.lifecycle_state IN ('active', 'submitted', 'grading', 'graded')
          AND NOT EXISTS (
              SELECT 1 FROM submission.evaluation_requests AS current_request
              WHERE current_request.tenant_id = attempt.tenant_id
                AND current_request.answer_revision_id = revision.id
                AND current_request.evaluation_bundle_checksum = item.evaluation_bundle_checksum
          )
    LOOP
        request_id := pg_catalog.uuidv7();
        INSERT INTO submission.evaluation_requests (
            id, tenant_id, attempt_id, answer_revision_id, evaluation_bundle_object_key, evaluation_bundle_checksum,
            caller_idempotency_key, maximum_score, origin
        ) VALUES (
            request_id, p_tenant_id, candidate.attempt_id, candidate.revision_id, candidate.evaluation_bundle_object_key,
            candidate.evaluation_bundle_checksum,
            'regrade:' || candidate.revision_id::text || ':' || lower(candidate.evaluation_bundle_checksum::text),
            candidate.maximum_score, 'regrade'
        );
        payload := jsonb_build_object(
            'evaluation_request_id', request_id,
            'attempt_id', candidate.attempt_id,
            'answer_revision_id', candidate.revision_id,
            'exam_item_id', p_exam_item_id,
            'evaluation_bundle_object_key', candidate.evaluation_bundle_object_key,
            'evaluation_bundle_checksum', candidate.evaluation_bundle_checksum,
            'maximum_score', candidate.maximum_score,
            'caller_idempotency_key', 'regrade:' || candidate.revision_id::text || ':' || lower(candidate.evaluation_bundle_checksum::text)
        );
        INSERT INTO app.outbox_events (
            event_id, aggregate_type, aggregate_id, tenant_id, event_type,
            schema_version, payload, payload_sha256, occurred_at
        ) VALUES (
            pg_catalog.uuidv7(), 'evaluation_request', request_id, p_tenant_id,
            'submission.evaluation_requested.v1', 1, payload,
            extensions.digest(convert_to(payload::text, 'UTF8'), 'sha256'), clock_timestamp()
        );
        requested := requested + 1;
    END LOOP;

    -- A graded attempt is graded again once its new evaluations finish.
    WITH reopened_attempts AS (
        UPDATE submission.attempts AS attempt
        SET lifecycle_state = 'grading', version = version + 1
        WHERE attempt.tenant_id = p_tenant_id AND attempt.exam_version_id = p_exam_version_id
          AND attempt.lifecycle_state = 'graded'
          AND EXISTS (
              SELECT 1 FROM submission.evaluation_requests AS request_row
              WHERE request_row.tenant_id = attempt.tenant_id AND request_row.attempt_id = attempt.id
                AND request_row.origin = 'regrade' AND request_row.lifecycle_state IN ('queued', 'dispatched')
          )
        RETURNING attempt.id
    ), logged AS (
        INSERT INTO submission.attempt_events (id, tenant_id, attempt_id, actor_id, event_type, payload)
        SELECT pg_catalog.uuidv7(), p_tenant_id, reopened_attempts.id, authz.current_context_actor_id(),
               'submission.attempt.regrading.v1', jsonb_build_object('exam_item_id', p_exam_item_id)
        FROM reopened_attempts
        RETURNING 1
    )
    SELECT count(*) INTO reopened FROM logged;
    RETURN jsonb_build_object('evaluations', requested, 'attempts_regrading', reopened);
END
$function$;
REVOKE ALL ON FUNCTION submission.regrade_exam_item(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submission.regrade_exam_item(uuid, uuid, uuid) TO aether_submission_app;

RESET ROLE;
