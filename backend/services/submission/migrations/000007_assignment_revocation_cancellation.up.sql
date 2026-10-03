-- An Assessment revocation is a terminal boundary for candidate work.  Apply
-- it in the same projection transaction that updates the local assignment
-- snapshot so candidates can never be left with an active but unusable
-- attempt.  Existing evidence stays append-only and late Judge completions
-- remain acknowledged without changing a cancelled attempt.
SET ROLE aether_submission_owner;

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
    p_items jsonb
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
        available_from, available_until, attempt_limit, lifecycle_state, version, source_event_id
    ) VALUES (
        p_tenant_id, p_candidate_assignment_id, p_candidate_id, p_exam_id, p_exam_version_id,
        p_available_from, p_available_until, p_attempt_limit, p_lifecycle_state, p_version, p_source_event_id
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
        evaluation_bundle_object_key, evaluation_bundle_checksum, maximum_score
    )
    SELECT
        p_tenant_id,
        p_candidate_assignment_id,
        (item ->> 'exam_item_id')::uuid,
        item ->> 'evaluation_bundle_object_key',
        item ->> 'evaluation_bundle_checksum',
        (item ->> 'maximum_score')::numeric(12,4)
    FROM jsonb_array_elements(p_items) AS item;

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

RESET ROLE;
