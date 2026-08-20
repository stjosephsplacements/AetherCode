-- Correct the workflow routines after the initial expand release.  Their
-- TABLE return fields intentionally mirror domain column names; PostgreSQL
-- treats those fields as PL/pgSQL variables unless the function's conflict
-- policy explicitly selects table columns.  All command inputs are p_-named,
-- so use_column is deterministic and preserves fail-closed authorization.
SET ROLE aether_submission_owner;

-- A completion retains its dispatch timestamp.  The original equivalence
-- check accidentally made `completed` rows impossible once dispatch metadata
-- was recorded.  Preserve the meaningful invariant: only the `dispatched`
-- state requires a dispatch timestamp.
ALTER TABLE submission.evaluation_requests
    DROP CONSTRAINT evaluation_requests_check;
ALTER TABLE submission.evaluation_requests
    ADD CONSTRAINT evaluation_requests_dispatched_at_check
    CHECK (lifecycle_state <> 'dispatched' OR dispatched_at IS NOT NULL);

DO $workflow_functions$
DECLARE
    target_function regprocedure;
    definition text;
    function_marker text := 'AS $function$' || E'\n';
    hardened_marker text := 'AS $function$' || E'\n#variable_conflict use_column' || E'\n';
BEGIN
    FOR target_function IN
        SELECT unnest(ARRAY[
            'submission.start_attempt(uuid,uuid,uuid,uuid,text,text)'::regprocedure,
            'submission.get_attempt_for_candidate(uuid,uuid)'::regprocedure,
            'submission.append_answer_revision(uuid,uuid,uuid,uuid,uuid,text,text,text,text,bigint)'::regprocedure,
            'submission.prepare_submission(uuid,uuid,bigint)'::regprocedure,
            'submission.submit_attempt(uuid,uuid,uuid,uuid,bigint,text,text,jsonb)'::regprocedure
        ])
    LOOP
        SELECT pg_get_functiondef(target_function::oid) INTO definition;
        IF position(function_marker IN definition) = 0 THEN
            RAISE EXCEPTION 'could not harden workflow function %', target_function;
        END IF;
        definition := replace(definition, function_marker, hardened_marker);
        EXECUTE definition;
    END LOOP;
END
$workflow_functions$;

-- A completed Judge request is terminal.  A late, distinct event for the
-- same request must be acknowledged as a no-op rather than recalculating a
-- score or publishing a duplicate graded event.  The graded outbox payload is
-- additive so analytics can join it without reading Submission tables.
CREATE OR REPLACE FUNCTION submission.record_judge_completion(
    p_receipt_id uuid,
    p_attempt_event_id uuid,
    p_score_summary_id uuid,
    p_outbox_event_id uuid,
    p_tenant_id uuid,
    p_evaluation_request_id uuid,
    p_judge_job_id uuid,
    p_judge_event_id uuid,
    p_verdict text,
    p_execution_time_ms integer,
    p_memory_kib integer,
    p_result_object_key text,
    p_result_checksum text,
    p_encryption_key_reference text,
    p_received_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, submission, extensions
AS $function$
DECLARE
    request_record submission.evaluation_requests%ROWTYPE;
    attempt_record submission.attempts%ROWTYPE;
    final_score numeric(12,4);
    final_maximum_score numeric(12,4);
    event_payload jsonb;
BEGIN
    IF p_receipt_id IS NULL OR p_attempt_event_id IS NULL OR p_score_summary_id IS NULL
       OR p_outbox_event_id IS NULL OR p_tenant_id IS NULL OR p_evaluation_request_id IS NULL
       OR p_judge_job_id IS NULL OR p_judge_event_id IS NULL OR p_received_at IS NULL
       OR p_verdict NOT IN (
            'accepted', 'wrong_answer', 'time_limit_exceeded', 'memory_limit_exceeded',
            'runtime_error', 'compile_error', 'internal_error', 'cancelled'
       )
       OR (p_execution_time_ms IS NOT NULL AND p_execution_time_ms < 0)
       OR (p_memory_kib IS NOT NULL AND p_memory_kib < 0)
       OR ((p_result_object_key IS NULL) <> (p_result_checksum IS NULL))
       OR ((p_result_object_key IS NULL) <> (p_encryption_key_reference IS NULL))
       OR (p_result_checksum IS NOT NULL AND p_result_checksum !~* '^[0-9a-f]{64}$')
    THEN
        RAISE EXCEPTION 'judge completion payload is invalid';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM submission.judge_receipts AS receipt
        WHERE receipt.tenant_id = p_tenant_id
          AND receipt.judge_event_id = p_judge_event_id
    ) THEN
        RETURN false;
    END IF;

    SELECT * INTO request_record
    FROM submission.evaluation_requests
    WHERE tenant_id = p_tenant_id AND id = p_evaluation_request_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'evaluation request was not found' USING ERRCODE = 'P0001';
    END IF;
    IF request_record.judge_job_id IS NOT NULL AND request_record.judge_job_id <> p_judge_job_id THEN
        RAISE EXCEPTION 'judge completion does not match the dispatched job';
    END IF;
    IF request_record.lifecycle_state IN ('completed', 'failed') THEN
        RETURN false;
    END IF;

    INSERT INTO submission.judge_receipts (
        id, tenant_id, evaluation_request_id, judge_job_id, judge_event_id, verdict,
        execution_time_ms, memory_kib, result_object_key, result_checksum,
        encryption_key_reference, received_at
    ) VALUES (
        p_receipt_id, p_tenant_id, p_evaluation_request_id, p_judge_job_id, p_judge_event_id, p_verdict,
        p_execution_time_ms, p_memory_kib, p_result_object_key, p_result_checksum,
        p_encryption_key_reference, p_received_at
    );

    IF request_record.lifecycle_state = 'cancelled' THEN
        RETURN false;
    END IF;

    UPDATE submission.evaluation_requests
    SET judge_job_id = p_judge_job_id,
        lifecycle_state = 'completed',
        dispatched_at = COALESCE(dispatched_at, p_received_at),
        completed_at = p_received_at,
        version = version + 1
    WHERE tenant_id = p_tenant_id AND id = p_evaluation_request_id;

    SELECT * INTO attempt_record
    FROM submission.attempts
    WHERE tenant_id = p_tenant_id AND id = request_record.attempt_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'evaluation request has no attempt' USING ERRCODE = 'P0001';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM submission.evaluation_requests AS request_row
        WHERE request_row.tenant_id = p_tenant_id
          AND request_row.attempt_id = attempt_record.id
          AND request_row.lifecycle_state IN ('queued', 'dispatched')
    ) THEN
        RETURN false;
    END IF;

    SELECT
        COALESCE(sum(CASE WHEN receipt.verdict = 'accepted' THEN request_row.maximum_score ELSE 0 END), 0),
        COALESCE(sum(request_row.maximum_score), 0)
    INTO final_score, final_maximum_score
    FROM submission.evaluation_requests AS request_row
    LEFT JOIN submission.judge_receipts AS receipt
      ON receipt.tenant_id = request_row.tenant_id
     AND receipt.evaluation_request_id = request_row.id
    WHERE request_row.tenant_id = p_tenant_id
      AND request_row.attempt_id = attempt_record.id;

    UPDATE submission.attempts
    SET lifecycle_state = 'graded',
        completed_at = COALESCE(completed_at, clock_timestamp()),
        version = version + 1
    WHERE tenant_id = p_tenant_id AND id = attempt_record.id
    RETURNING * INTO attempt_record;

    INSERT INTO submission.score_summaries (
        id, tenant_id, attempt_id, score, maximum_score,
        lifecycle_state, calculation_version, finalized_at
    ) VALUES (
        p_score_summary_id, p_tenant_id, attempt_record.id, final_score, final_maximum_score,
        'finalized', 1, clock_timestamp()
    )
    ON CONFLICT (tenant_id, attempt_id) DO UPDATE
    SET score = EXCLUDED.score,
        maximum_score = EXCLUDED.maximum_score,
        lifecycle_state = 'finalized',
        calculation_version = submission.score_summaries.calculation_version + 1,
        calculated_at = clock_timestamp(),
        finalized_at = clock_timestamp(),
        version = submission.score_summaries.version + 1;

    INSERT INTO submission.attempt_events (id, tenant_id, attempt_id, event_type, payload)
    VALUES (
        p_attempt_event_id, p_tenant_id, attempt_record.id, 'submission.attempt.graded.v1',
        jsonb_build_object(
            'attempt_id', attempt_record.id,
            'tenant_id', attempt_record.tenant_id,
            'candidate_assignment_id', attempt_record.candidate_assignment_id,
            'candidate_id', attempt_record.candidate_id,
            'exam_id', attempt_record.exam_id,
            'exam_version_id', attempt_record.exam_version_id,
            'attempt_number', attempt_record.attempt_number,
            'lifecycle_state', attempt_record.lifecycle_state,
            'score', final_score,
            'maximum_score', final_maximum_score
        )
    );

    event_payload := jsonb_build_object(
        'attempt_id', attempt_record.id,
        'tenant_id', attempt_record.tenant_id,
        'candidate_assignment_id', attempt_record.candidate_assignment_id,
        'candidate_id', attempt_record.candidate_id,
        'exam_id', attempt_record.exam_id,
        'exam_version_id', attempt_record.exam_version_id,
        'attempt_number', attempt_record.attempt_number,
        'lifecycle_state', attempt_record.lifecycle_state,
        'score', final_score,
        'maximum_score', final_maximum_score,
        'completed_at', attempt_record.completed_at
    );
    INSERT INTO app.outbox_events (
        event_id, aggregate_type, aggregate_id, tenant_id, event_type,
        schema_version, payload, payload_sha256, occurred_at
    ) VALUES (
        p_outbox_event_id, 'attempt', attempt_record.id, p_tenant_id, 'submission.attempt_graded.v1',
        1, event_payload,
        extensions.digest(convert_to(event_payload::text, 'UTF8'), 'sha256'), clock_timestamp()
    );

    RETURN true;
END
$function$;

RESET ROLE;
