SET ROLE aether_submission_owner;

-- Restore both functions as migrations 000031 and 000033 left them.
CREATE OR REPLACE FUNCTION submission.apply_assignment_snapshot(
    p_source_event_id uuid,
    p_tenant_id uuid,
    p_candidate_assignment_id uuid,
    p_candidate_id uuid,
    p_exam_id uuid,
    p_exam_version_id uuid,
    p_available_from timestamptz,
    p_available_until timestamptz,
    p_attempt_limit smallint,
    p_lifecycle_state text,
    p_version bigint,
    p_items jsonb,
    p_duration_seconds integer,
    p_title text,
    p_instructions_markdown text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, submission
AS $function$
DECLARE
    applied boolean;
    item_count integer;
    distinct_item_count integer;
    cancelled_attempt submission.attempts%ROWTYPE;
    cancellation_payload jsonb;
BEGIN
    IF p_source_event_id IS NULL
       OR p_tenant_id IS NULL
       OR p_candidate_assignment_id IS NULL
       OR p_candidate_id IS NULL
       OR p_exam_id IS NULL
       OR p_exam_version_id IS NULL
       OR p_available_from IS NULL
       OR p_available_until IS NULL
       OR p_available_from >= p_available_until
       OR p_attempt_limit NOT BETWEEN 1 AND 20
       OR p_lifecycle_state NOT IN ('active', 'revoked')
       OR p_version <= 0
       OR jsonb_typeof(p_items) <> 'array'
       OR p_duration_seconds NOT BETWEEN 60 AND 43200
    THEN
        RAISE EXCEPTION 'assessment assignment snapshot is invalid';
    END IF;

    SELECT count(*), count(DISTINCT item ->> 'exam_item_id')
    INTO item_count, distinct_item_count
    FROM jsonb_array_elements(p_items) AS item;
    IF (p_lifecycle_state = 'active' AND item_count = 0) OR item_count <> distinct_item_count THEN
        RAISE EXCEPTION 'assessment assignment snapshot items are invalid';
    END IF;

    INSERT INTO submission.assignment_projections AS projection (
        tenant_id, candidate_assignment_id, candidate_id, exam_id, exam_version_id,
        available_from, available_until, attempt_limit, lifecycle_state, version, source_event_id,
        duration_seconds, title, instructions_markdown
    ) VALUES (
        p_tenant_id, p_candidate_assignment_id, p_candidate_id, p_exam_id, p_exam_version_id,
        p_available_from, p_available_until, p_attempt_limit, p_lifecycle_state, p_version, p_source_event_id,
        p_duration_seconds, p_title, p_instructions_markdown
    )
    ON CONFLICT (tenant_id, candidate_assignment_id) DO UPDATE
    SET candidate_id = EXCLUDED.candidate_id,
        exam_id = EXCLUDED.exam_id,
        exam_version_id = EXCLUDED.exam_version_id,
        available_from = EXCLUDED.available_from,
        available_until = EXCLUDED.available_until,
        attempt_limit = EXCLUDED.attempt_limit,
        lifecycle_state = EXCLUDED.lifecycle_state,
        version = EXCLUDED.version,
        source_event_id = EXCLUDED.source_event_id,
        duration_seconds = EXCLUDED.duration_seconds,
        title = EXCLUDED.title,
        instructions_markdown = EXCLUDED.instructions_markdown,
        updated_at = clock_timestamp()
    WHERE EXCLUDED.version > projection.version
    RETURNING true INTO applied;

    IF NOT COALESCE(applied, false) THEN
        RETURN false;
    END IF;

    DELETE FROM submission.assignment_item_projections
    WHERE tenant_id = p_tenant_id
      AND candidate_assignment_id = p_candidate_assignment_id;

    INSERT INTO submission.assignment_item_projections (
        tenant_id, candidate_assignment_id, exam_item_id,
        evaluation_bundle_object_key, evaluation_bundle_checksum, maximum_score,
        evaluation_bundle_key_reference, sample_bundle_object_key, sample_bundle_checksum,
        sample_bundle_key_reference, time_limit_ms, memory_limit_kib, supported_languages,
        position, title, prompt_markdown, kind, choices, correct_choices, multiple_choice
    )
    SELECT
        p_tenant_id,
        p_candidate_assignment_id,
        (item ->> 'exam_item_id')::uuid,
        item ->> 'evaluation_bundle_object_key',
        item ->> 'evaluation_bundle_checksum',
        (item ->> 'maximum_score')::numeric(12,4),
        NULLIF(item ->> 'evaluation_bundle_key_reference', ''),
        NULLIF(item ->> 'sample_bundle_object_key', ''),
        NULLIF(item ->> 'sample_bundle_checksum', ''),
        NULLIF(item ->> 'sample_bundle_key_reference', ''),
        (item ->> 'time_limit_ms')::integer,
        (item ->> 'memory_limit_kib')::integer,
        CASE WHEN jsonb_typeof(item -> 'supported_languages') = 'array'
             THEN ARRAY(SELECT jsonb_array_elements_text(item -> 'supported_languages'))
        END,
        ordinal::integer,
        NULLIF(item ->> 'title', ''),
        NULLIF(item ->> 'prompt_markdown', ''),
        COALESCE(item ->> 'kind', 'coding'),
        CASE WHEN jsonb_typeof(item -> 'choices') = 'array' THEN item -> 'choices' END,
        CASE WHEN jsonb_typeof(item -> 'correct_choices') = 'array'
             THEN ARRAY(SELECT jsonb_array_elements_text(item -> 'correct_choices')::integer)
        END,
        COALESCE((item ->> 'multiple_choice')::boolean, false)
    FROM jsonb_array_elements(p_items) WITH ORDINALITY AS element(item, ordinal);

    IF p_lifecycle_state <> 'revoked' THEN
        RETURN true;
    END IF;

    -- Lock and cancel every nonterminal attempt before cancelling its queued
    -- Judge work.  The source-event/version gate above makes replay harmless.
    FOR cancelled_attempt IN
        UPDATE submission.attempts AS attempt_row
        SET lifecycle_state = 'cancelled',
            completed_at = COALESCE(attempt_row.completed_at, clock_timestamp()),
            version = attempt_row.version + 1
        WHERE attempt_row.tenant_id = p_tenant_id
          AND attempt_row.candidate_assignment_id = p_candidate_assignment_id
          AND attempt_row.lifecycle_state IN ('created', 'active', 'submitted', 'grading')
        RETURNING attempt_row.*
    LOOP
        UPDATE submission.evaluation_requests AS request_row
        SET lifecycle_state = 'cancelled',
            completed_at = COALESCE(request_row.completed_at, clock_timestamp()),
            failure_code = 'assessment_assignment_revoked',
            version = request_row.version + 1
        WHERE request_row.tenant_id = p_tenant_id
          AND request_row.attempt_id = cancelled_attempt.id
          AND request_row.lifecycle_state IN ('queued', 'dispatched');

        cancellation_payload := jsonb_build_object(
            'attempt_id', cancelled_attempt.id,
            'tenant_id', cancelled_attempt.tenant_id,
            'candidate_assignment_id', cancelled_attempt.candidate_assignment_id,
            'candidate_id', cancelled_attempt.candidate_id,
            'exam_id', cancelled_attempt.exam_id,
            'exam_version_id', cancelled_attempt.exam_version_id,
            'attempt_number', cancelled_attempt.attempt_number,
            'lifecycle_state', cancelled_attempt.lifecycle_state,
            'cancellation_reason', 'assessment_assignment_revoked',
            'assessment_snapshot_event_id', p_source_event_id,
            'cancelled_at', cancelled_attempt.completed_at
        );

        INSERT INTO submission.attempt_events (id, tenant_id, attempt_id, event_type, payload)
        VALUES (
            extensions.gen_random_uuid(), p_tenant_id, cancelled_attempt.id,
            'submission.attempt.cancelled.v1', cancellation_payload
        );

        INSERT INTO app.outbox_events (
            event_id, aggregate_type, aggregate_id, tenant_id, event_type,
            schema_version, payload, payload_sha256, occurred_at
        ) VALUES (
            extensions.gen_random_uuid(), 'attempt', cancelled_attempt.id, p_tenant_id,
            'submission.attempt_cancelled.v1', 1, cancellation_payload,
            extensions.digest(convert_to(cancellation_payload::text, 'UTF8'), 'sha256'), clock_timestamp()
        );
    END LOOP;

    RETURN true;
END
$function$;

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
                       'maximum_score', item.maximum_score,
                       'kind', item.kind,
                       -- Each test's verdict in the item's best evaluation, by
                       -- number only: inputs and outputs of hidden tests stay
                       -- hidden after release too (ADR-0038).
                       'tests', COALESCE((
                           SELECT jsonb_agg(jsonb_build_object('number', unit.unit_number + 1, 'verdict', unit.verdict)
                                            ORDER BY unit.unit_number)
                           FROM (
                               SELECT request_row.id
                               FROM submission.evaluation_requests AS request_row
                               JOIN submission.answer_revisions AS revision
                                 ON revision.tenant_id = request_row.tenant_id AND revision.id = request_row.answer_revision_id
                               WHERE request_row.tenant_id = p_tenant_id AND request_row.attempt_id = p_attempt_id
                                 AND revision.exam_item_id = item.exam_item_id AND request_row.lifecycle_state = 'completed'
                               ORDER BY submission.evaluation_score(p_tenant_id, request_row.id) DESC, request_row.queued_at DESC
                               LIMIT 1
                           ) AS best
                           JOIN LATERAL (
                               SELECT receipt.id FROM submission.judge_receipts AS receipt
                               WHERE receipt.tenant_id = p_tenant_id AND receipt.evaluation_request_id = best.id
                               ORDER BY receipt.received_at DESC LIMIT 1
                           ) AS receipt ON true
                           JOIN submission.judge_receipt_units AS unit
                             ON unit.tenant_id = p_tenant_id AND unit.judge_receipt_id = receipt.id
                       ), '[]'::jsonb)
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

ALTER TABLE submission.assignment_item_projections DROP COLUMN choice_explanations;

RESET ROLE;
