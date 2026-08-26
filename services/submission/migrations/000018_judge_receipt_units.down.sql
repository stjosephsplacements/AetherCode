-- Rolling back removes durable grading evidence, so it refuses to run once any
-- per-unit record exists, exactly as 000010 refuses while completion ingress
-- records exist.
--
-- Both routines are restored to their pre-000018 definitions in full: the
-- reconciliation routine would otherwise reference a dropped table, and
-- 000010's own rollback revokes the fourteen-argument ingress signature by
-- name, which must therefore exist again after this migration is undone.
SET ROLE aether_submission_owner;

DO $rollback_guard$
BEGIN
    IF EXISTS (SELECT 1 FROM submission.judge_receipt_units) THEN
        RAISE EXCEPTION 'cannot roll back per-unit Judge results while durable receipt unit records exist';
    END IF;
END
$rollback_guard$;

DROP FUNCTION IF EXISTS submission.get_attempt_unit_summary_for_candidate(uuid, uuid);
DROP FUNCTION IF EXISTS submission.list_attempt_unit_results(uuid, uuid);

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

REVOKE ALL ON FUNCTION submission.ingest_judge_completion(
    uuid, uuid, uuid, uuid, text, uuid, uuid, text, integer, integer, text, text, text, timestamptz, jsonb
) FROM aether_submission_judge_adapter;
DROP FUNCTION submission.ingest_judge_completion(
    uuid, uuid, uuid, uuid, text, uuid, uuid, text, integer, integer, text, text, text, timestamptz, jsonb
);

CREATE FUNCTION submission.ingest_judge_completion(
    p_outbox_event_id uuid,
    p_judge_event_id uuid,
    p_delivery_id uuid,
    p_lease_id uuid,
    p_consumer_id text,
    p_evaluation_request_id uuid,
    p_judge_job_id uuid,
    p_verdict text,
    p_execution_time_ms integer,
    p_memory_kib integer,
    p_result_object_key text,
    p_result_checksum text,
    p_encryption_key_reference text,
    p_completed_at timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, submission, app, extensions
AS $function$
DECLARE
    request_record submission.evaluation_requests%ROWTYPE;
    existing_ingress submission.judge_completion_ingress%ROWTYPE;
    event_payload jsonb;
    event_payload_sha256 bytea;
BEGIN
    IF p_outbox_event_id IS NULL OR p_judge_event_id IS NULL OR p_delivery_id IS NULL
       OR p_lease_id IS NULL OR p_evaluation_request_id IS NULL OR p_judge_job_id IS NULL
       OR p_completed_at IS NULL
       OR p_outbox_event_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR p_judge_event_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR p_delivery_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR p_lease_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR p_evaluation_request_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR p_judge_job_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR length(btrim(COALESCE(p_consumer_id, ''))) NOT BETWEEN 1 AND 255
       OR p_verdict NOT IN (
           'accepted', 'wrong_answer', 'time_limit_exceeded', 'memory_limit_exceeded',
           'runtime_error', 'compile_error', 'internal_error', 'cancelled'
       )
       OR (p_execution_time_ms IS NOT NULL AND p_execution_time_ms < 0)
       OR (p_memory_kib IS NOT NULL AND p_memory_kib < 0)
       OR ((p_result_object_key IS NULL) <> (p_result_checksum IS NULL))
       OR ((p_result_object_key IS NULL) <> (p_encryption_key_reference IS NULL))
       OR (p_result_object_key IS NOT NULL AND length(btrim(p_result_object_key)) NOT BETWEEN 1 AND 2048)
       OR (p_result_checksum IS NOT NULL AND btrim(p_result_checksum) !~ '^[0-9a-f]{64}$')
       OR (p_encryption_key_reference IS NOT NULL AND length(btrim(p_encryption_key_reference)) NOT BETWEEN 1 AND 1024)
    THEN
        RAISE EXCEPTION 'Judge completion ingress is invalid' USING ERRCODE = '22023';
    END IF;

    -- Serialize a re-leased event before resolving local correlation. This
    -- prevents a duplicate delivery from creating another local outbox event
    -- even if a caller races with a recovered adapter replica.
    PERFORM pg_advisory_xact_lock(hashtextextended(p_judge_event_id::text, 0));

    SELECT * INTO request_record
    FROM submission.evaluation_requests
    WHERE id = p_evaluation_request_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'evaluation request was not found' USING ERRCODE = 'P0001';
    END IF;
    IF request_record.judge_job_id IS NULL OR request_record.judge_job_id <> p_judge_job_id THEN
        RAISE EXCEPTION 'Judge completion does not match a locally dispatched job' USING ERRCODE = 'P0001';
    END IF;

    event_payload := jsonb_build_object(
        'tenant_id', request_record.tenant_id,
        'evaluation_request_id', request_record.id,
        'judge_job_id', p_judge_job_id,
        'judge_event_id', p_judge_event_id,
        'verdict', p_verdict,
        'execution_time_ms', p_execution_time_ms,
        'memory_kib', p_memory_kib,
        'result_object_key', NULLIF(btrim(p_result_object_key), ''),
        'result_checksum', NULLIF(btrim(p_result_checksum), ''),
        'encryption_key_reference', NULLIF(btrim(p_encryption_key_reference), ''),
        'completed_at', to_char(
            p_completed_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
        )
    );
    event_payload_sha256 := extensions.digest(convert_to(event_payload::text, 'UTF8'), 'sha256');

    SELECT * INTO existing_ingress
    FROM submission.judge_completion_ingress
    WHERE judge_event_id = p_judge_event_id;
    IF FOUND THEN
        IF existing_ingress.payload_sha256 <> event_payload_sha256 THEN
            RAISE EXCEPTION 'Judge event id was replayed with a different completion payload' USING ERRCODE = '23505';
        END IF;
        INSERT INTO submission.judge_completion_ingress_deliveries (
            delivery_id, judge_event_id, lease_id, consumer_id
        ) VALUES (
            p_delivery_id, p_judge_event_id, p_lease_id, btrim(p_consumer_id)
        ) ON CONFLICT (delivery_id) DO NOTHING;
        IF NOT EXISTS (
            SELECT 1
            FROM submission.judge_completion_ingress_deliveries
            WHERE delivery_id = p_delivery_id
              AND judge_event_id = p_judge_event_id
              AND lease_id = p_lease_id
              AND consumer_id = btrim(p_consumer_id)
        ) THEN
            RAISE EXCEPTION 'Judge delivery id was replayed with a different lease' USING ERRCODE = '23505';
        END IF;
        RETURN existing_ingress.outbox_event_id;
    END IF;

    INSERT INTO app.outbox_events (
        event_id, aggregate_type, aggregate_id, tenant_id, event_type,
        schema_version, payload, payload_sha256, occurred_at
    ) VALUES (
        p_outbox_event_id, 'evaluation_request', request_record.id, request_record.tenant_id,
        'judge.completed.v1', 1, event_payload, event_payload_sha256, p_completed_at
    );
    INSERT INTO submission.judge_completion_ingress (
        judge_event_id, tenant_id, evaluation_request_id, judge_job_id, verdict,
        execution_time_ms, memory_kib, result_object_key, result_checksum,
        encryption_key_reference, completed_at, payload_sha256, outbox_event_id
    ) VALUES (
        p_judge_event_id, request_record.tenant_id, request_record.id, p_judge_job_id, p_verdict,
        p_execution_time_ms, p_memory_kib, NULLIF(btrim(p_result_object_key), ''),
        NULLIF(btrim(p_result_checksum), ''), NULLIF(btrim(p_encryption_key_reference), ''),
        p_completed_at, event_payload_sha256, p_outbox_event_id
    );
    INSERT INTO submission.judge_completion_ingress_deliveries (
        delivery_id, judge_event_id, lease_id, consumer_id
    ) VALUES (
        p_delivery_id, p_judge_event_id, p_lease_id, btrim(p_consumer_id)
    );

    RETURN p_outbox_event_id;
END
$function$;

REVOKE ALL ON FUNCTION submission.ingest_judge_completion(
    uuid, uuid, uuid, uuid, text, uuid, uuid, text, integer, integer, text, text, text, timestamptz
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submission.ingest_judge_completion(
    uuid, uuid, uuid, uuid, text, uuid, uuid, text, integer, integer, text, text, text, timestamptz
) TO aether_submission_judge_adapter;

DROP TABLE submission.judge_receipt_units;

ALTER TABLE submission.judge_completion_ingress
    DROP COLUMN unit_results;

RESET ROLE;
