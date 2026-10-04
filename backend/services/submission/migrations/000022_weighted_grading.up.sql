-- Weighted scoring. Judge reports each test's weight (1-100); an item now earns
-- maximum_score x (weight of passed tests) / (weight of all tests) instead of
-- all or nothing. A receipt with no unit breakdown keeps the all-or-nothing
-- rule, so completions recorded before weights existed score as they did.
-- Scores are written with calculation_version 2.
--
-- The tail of record_judge_completion that closes an attempt moves into
-- finalize_attempt_grading so a permanently failed dispatch can close an
-- attempt the same way a completion does.
SET ROLE aether_submission_owner;

ALTER TABLE submission.judge_receipt_units
    ADD COLUMN weight integer NOT NULL DEFAULT 1 CHECK (weight BETWEEN 1 AND 100);

CREATE OR REPLACE FUNCTION submission.ingest_judge_completion(
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
    p_completed_at timestamptz,
    p_unit_results jsonb
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
       OR p_unit_results IS NULL
       OR jsonb_typeof(p_unit_results) <> 'array'
       -- Invariant: 1000 here must stay >= judge's per-bundle test-case bound
       -- (services/judge/internal/bundle/bundle.go's maxTestCases) and must
       -- match maxUnitResults in
       -- services/submission/internal/adapters/judgecompletion/completion.go.
       -- If judge's bound is ever raised above this one without raising this
       -- check and maxUnitResults too, every completion for such a job would
       -- fail this CHECK/validateUnitResults, Worker.ProcessOnce would never
       -- acknowledge the failing message, and the same head-of-queue
       -- completion would be re-pulled and re-fail forever.
       OR jsonb_array_length(p_unit_results) > 1000
    THEN
        RAISE EXCEPTION 'Judge completion ingress is invalid' USING ERRCODE = '22023';
    END IF;

    -- Each element must be a complete, bounded unit record. The nine-digit
    -- bound keeps every value inside the integer column it is later expanded
    -- into, so submission.record_judge_completion can never fail on a cast.
    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_unit_results) AS unit
        WHERE jsonb_typeof(unit) <> 'object'
           OR COALESCE(unit ->> 'unit_number', '') !~ '^[0-9]{1,9}$'
           OR COALESCE(unit ->> 'verdict', '') NOT IN (
                  'accepted', 'wrong_answer', 'time_limit_exceeded', 'memory_limit_exceeded',
                  'runtime_error', 'compile_error', 'internal_error', 'cancelled'
              )
           OR (unit ->> 'execution_time_ms' IS NOT NULL AND (unit ->> 'execution_time_ms') !~ '^[0-9]{1,9}$')
           OR (unit ->> 'memory_kib' IS NOT NULL AND (unit ->> 'memory_kib') !~ '^[0-9]{1,9}$')
           -- A test weight is 1-100; an absent weight (a completion Judge
           -- stored before it reported weights) counts as 1.
           OR (unit ->> 'weight' IS NOT NULL AND CASE
                  WHEN (unit ->> 'weight') ~ '^[0-9]{1,3}$' THEN (unit ->> 'weight')::integer NOT BETWEEN 1 AND 100
                  ELSE true
              END)
    ) OR (
        SELECT count(*) <> count(DISTINCT unit ->> 'unit_number')
        FROM jsonb_array_elements(p_unit_results) AS unit
    ) THEN
        RAISE EXCEPTION 'Judge completion unit results are invalid' USING ERRCODE = '22023';
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
        -- A stored breakdown that later differs is a genuine replay violation.
        -- An empty stored breakdown is not: it is also what a completion
        -- ingested before this migration carries, and rejecting its redelivery
        -- would stall the bridge on that completion forever, since the adapter
        -- acknowledges nothing it could not persist and re-pulls the same head
        -- of queue on every tick.
        IF existing_ingress.payload_sha256 <> event_payload_sha256
           OR (existing_ingress.unit_results <> '[]'::jsonb
               AND existing_ingress.unit_results <> p_unit_results) THEN
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
        encryption_key_reference, completed_at, payload_sha256, outbox_event_id, unit_results
    ) VALUES (
        p_judge_event_id, request_record.tenant_id, request_record.id, p_judge_job_id, p_verdict,
        p_execution_time_ms, p_memory_kib, NULLIF(btrim(p_result_object_key), ''),
        NULLIF(btrim(p_result_checksum), ''), NULLIF(btrim(p_encryption_key_reference), ''),
        p_completed_at, event_payload_sha256, p_outbox_event_id, p_unit_results
    );
    INSERT INTO submission.judge_completion_ingress_deliveries (
        delivery_id, judge_event_id, lease_id, consumer_id
    ) VALUES (
        p_delivery_id, p_judge_event_id, p_lease_id, btrim(p_consumer_id)
    );

    RETURN p_outbox_event_id;
END
$function$;


-- Closes an attempt once none of its evaluation requests is waiting on Judge:
-- scores it, marks it graded and announces it. Shared by the two ways a
-- request leaves the queued/dispatched states (a Judge completion and a
-- permanent dispatch failure). Internal: executable by no role directly, only
-- through the SECURITY DEFINER routines that call it.
CREATE FUNCTION submission.finalize_attempt_grading(
    p_tenant_id uuid,
    p_attempt_id uuid,
    p_attempt_event_id uuid,
    p_score_summary_id uuid,
    p_outbox_event_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, submission, extensions
AS $function$
DECLARE
    attempt_record submission.attempts%ROWTYPE;
    final_score numeric(12,4);
    final_maximum_score numeric(12,4);
    event_payload jsonb;
BEGIN
    SELECT * INTO attempt_record
    FROM submission.attempts
    WHERE tenant_id = p_tenant_id AND id = p_attempt_id
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

    -- An item earns its maximum score in proportion to the weight of the tests
    -- it passed. A receipt without a unit breakdown (a compile error reaches no
    -- test; a completion from before units were reported) is all or nothing, and
    -- a failed request has no receipt and earns nothing.
    SELECT
        COALESCE(sum(CASE
            WHEN unit_totals.total_weight IS NULL THEN
                CASE WHEN receipt.verdict = 'accepted' THEN request_row.maximum_score ELSE 0 END
            ELSE request_row.maximum_score * unit_totals.passed_weight / unit_totals.total_weight
        END), 0),
        COALESCE(sum(request_row.maximum_score), 0)
    INTO final_score, final_maximum_score
    FROM submission.evaluation_requests AS request_row
    LEFT JOIN submission.judge_receipts AS receipt
      ON receipt.tenant_id = request_row.tenant_id
     AND receipt.evaluation_request_id = request_row.id
    LEFT JOIN LATERAL (
        SELECT sum(unit.weight) AS total_weight,
               COALESCE(sum(unit.weight) FILTER (WHERE unit.verdict = 'accepted'), 0) AS passed_weight
        FROM submission.judge_receipt_units AS unit
        WHERE unit.tenant_id = receipt.tenant_id AND unit.judge_receipt_id = receipt.id
    ) AS unit_totals ON true
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
        'finalized', 2, clock_timestamp()
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

REVOKE ALL ON FUNCTION submission.finalize_attempt_grading(uuid, uuid, uuid, uuid, uuid) FROM PUBLIC;

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

    -- A completion with no unit breakdown (a compile error reaches no test
    -- case) selects zero rows, which is the correct empty result rather than a
    -- failure.
    INSERT INTO submission.judge_receipt_units (
        id, tenant_id, judge_receipt_id, unit_number, verdict, execution_time_ms, memory_kib, weight
    )
    SELECT uuidv7(), p_tenant_id, p_receipt_id,
           (unit ->> 'unit_number')::integer, unit ->> 'verdict',
           (unit ->> 'execution_time_ms')::integer, (unit ->> 'memory_kib')::integer,
           COALESCE((unit ->> 'weight')::integer, 1)
    FROM submission.judge_completion_ingress AS ingress
    CROSS JOIN LATERAL jsonb_array_elements(ingress.unit_results) AS unit
    WHERE ingress.judge_event_id = p_judge_event_id
      AND ingress.tenant_id = p_tenant_id;

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

    RETURN submission.finalize_attempt_grading(
        p_tenant_id, request_record.attempt_id, p_attempt_event_id, p_score_summary_id, p_outbox_event_id
    );
END
$function$;


-- A request Judge permanently refuses (or that can never be built, such as an
-- item projected without limits) is failed rather than retried. It scores zero,
-- and failing the last open request still grades the attempt, so a candidate is
-- never left waiting on work that cannot complete.
CREATE FUNCTION submission.mark_evaluation_failed(
    p_tenant_id uuid,
    p_evaluation_request_id uuid,
    p_failure_code text,
    p_attempt_event_id uuid,
    p_score_summary_id uuid,
    p_outbox_event_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, submission
AS $function$
DECLARE
    failed_attempt_id uuid;
BEGIN
    IF p_tenant_id IS NULL OR p_evaluation_request_id IS NULL OR p_attempt_event_id IS NULL
       OR p_score_summary_id IS NULL OR p_outbox_event_id IS NULL
       OR p_failure_code IS NULL OR length(btrim(p_failure_code)) NOT BETWEEN 1 AND 100 THEN
        RAISE EXCEPTION 'evaluation failure is invalid' USING ERRCODE = '22023';
    END IF;

    UPDATE submission.evaluation_requests AS request_row
    SET lifecycle_state = 'failed',
        failure_code = btrim(p_failure_code),
        completed_at = clock_timestamp(),
        version = request_row.version + 1
    WHERE request_row.tenant_id = p_tenant_id
      AND request_row.id = p_evaluation_request_id
      AND request_row.lifecycle_state = 'queued'
    RETURNING request_row.attempt_id INTO failed_attempt_id;
    IF NOT FOUND THEN
        RETURN false;
    END IF;

    RETURN submission.finalize_attempt_grading(
        p_tenant_id, failed_attempt_id, p_attempt_event_id, p_score_summary_id, p_outbox_event_id
    );
END
$function$;

REVOKE ALL ON FUNCTION submission.mark_evaluation_failed(uuid, uuid, text, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submission.mark_evaluation_failed(uuid, uuid, text, uuid, uuid, uuid)
    TO aether_submission_judge_adapter;

RESET ROLE;
