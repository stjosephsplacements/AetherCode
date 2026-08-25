-- Per-test-case Judge results. The wrapper already reports one normalized
-- verdict per execution unit; Submission now retains that breakdown so a
-- reviewer can see which specific hidden test failed.
--
-- The breakdown travels on the ingress row rather than inside the
-- judge.completed.v1 outbox payload. Per-unit verdicts are reviewer-grade
-- evidence, and the platform event is a broadcast subject that other services
-- subscribe to; keeping the breakdown out of it also leaves the existing
-- payload fingerprint byte-identical for already-ingested completions. The
-- ingress row and the outbox event are written in one transaction and share
-- judge_event_id, so submission.record_judge_completion can always correlate
-- them. See docs/adr/0015-judge-per-unit-result-visibility.md.
SET ROLE aether_submission_owner;

ALTER TABLE submission.judge_completion_ingress
    ADD COLUMN unit_results jsonb NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(unit_results) = 'array');

CREATE TABLE submission.judge_receipt_units (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    judge_receipt_id uuid NOT NULL,
    unit_number integer NOT NULL CHECK (unit_number >= 0),
    verdict text NOT NULL
        CHECK (verdict IN ('accepted', 'wrong_answer', 'time_limit_exceeded', 'memory_limit_exceeded', 'runtime_error', 'compile_error', 'internal_error', 'cancelled')),
    execution_time_ms integer CHECK (execution_time_ms IS NULL OR execution_time_ms >= 0),
    memory_kib integer CHECK (memory_kib IS NULL OR memory_kib >= 0),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, judge_receipt_id, unit_number),
    FOREIGN KEY (tenant_id, judge_receipt_id)
        REFERENCES submission.judge_receipts (tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX judge_receipt_units_receipt_idx
    ON submission.judge_receipt_units (tenant_id, judge_receipt_id, unit_number);

CREATE TRIGGER judge_receipt_units_append_only
    BEFORE UPDATE OR DELETE ON submission.judge_receipt_units
    FOR EACH ROW EXECUTE FUNCTION submission.reject_append_only_mutation();

-- Same posture as submission.judge_receipts: 000005 revoked every direct table
-- privilege from aether_submission_app, so the only reachable paths are the
-- SECURITY DEFINER routines below and owner maintenance. No app-role policy is
-- created because no app-role privilege exists for one to gate.
ALTER TABLE submission.judge_receipt_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission.judge_receipt_units FORCE ROW LEVEL SECURITY;
CREATE POLICY submission_judge_receipt_units_owner_maintenance
    ON submission.judge_receipt_units
    FOR ALL TO aether_submission_owner USING (true) WITH CHECK (true);

-- The ingress routine gains p_unit_results, so its identity changes. Drop the
-- previous signature rather than leaving an overload the adapter could still
-- reach with no unit breakdown.
REVOKE ALL ON FUNCTION submission.ingest_judge_completion(
    uuid, uuid, uuid, uuid, text, uuid, uuid, text, integer, integer, text, text, text, timestamptz
) FROM aether_submission_judge_adapter;
DROP FUNCTION submission.ingest_judge_completion(
    uuid, uuid, uuid, uuid, text, uuid, uuid, text, integer, integer, text, text, text, timestamptz
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

REVOKE ALL ON FUNCTION submission.ingest_judge_completion(
    uuid, uuid, uuid, uuid, text, uuid, uuid, text, integer, integer, text, text, text, timestamptz, jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submission.ingest_judge_completion(
    uuid, uuid, uuid, uuid, text, uuid, uuid, text, integer, integer, text, text, text, timestamptz, jsonb
) TO aether_submission_judge_adapter;

-- Reconciliation now materializes the unit breakdown recorded at ingress next
-- to the receipt it belongs to, inside the receipt's own transaction. The
-- breakdown is written before the cancelled-request early return so a
-- cancelled attempt keeps the same evidence a graded one does.
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

    -- A completion with no unit breakdown (a compile error reaches no test
    -- case) selects zero rows, which is the correct empty result rather than a
    -- failure.
    INSERT INTO submission.judge_receipt_units (
        id, tenant_id, judge_receipt_id, unit_number, verdict, execution_time_ms, memory_kib
    )
    SELECT uuidv7(), p_tenant_id, p_receipt_id,
           (unit ->> 'unit_number')::integer, unit ->> 'verdict',
           (unit ->> 'execution_time_ms')::integer, (unit ->> 'memory_kib')::integer
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

-- A candidate learns how many hidden tests passed and nothing else. Exposing
-- which unit number failed, or how long it ran, leaks the shape of a hidden
-- test back into an exam that is still being sat by other candidates.
--
-- This function has no attempt.lifecycle_state predicate. That is
-- intentional/structural, not an oversight: a submission.judge_receipts row
-- (and therefore a submission.judge_receipt_units row) can only exist after
-- an attempt has been formally submitted for evaluation, so there is no
-- lifecycle_state under which a receipt could reflect mid-attempt work. This
-- assumption becomes load-bearing, and must be re-verified, if a later plan
-- (e.g. candidate-run-code) ever introduces a mid-attempt code-execution
-- path that writes to judge_receipts, judge_receipt_units, or any other
-- table this function reads from.
CREATE FUNCTION submission.get_attempt_unit_summary_for_candidate(
    p_tenant_id uuid,
    p_attempt_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, submission, authz
AS $function$
DECLARE
    signed_actor_id uuid;
    response jsonb;
BEGIN
    IF NOT authz.current_context_allows_read(
        p_tenant_id, 'submission.read', 'submission.write', 'submission.attempts'
    ) THEN
        RAISE EXCEPTION 'signed authorization context does not allow this submission operation'
            USING ERRCODE = '42501';
    END IF;
    signed_actor_id := authz.current_context_actor_id();
    IF signed_actor_id IS NULL THEN
        RAISE EXCEPTION 'current authorization context has no actor' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM submission.attempts AS attempt
        WHERE attempt.tenant_id = p_tenant_id
          AND attempt.id = p_attempt_id
          AND attempt.candidate_id = signed_actor_id
          AND attempt.deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'candidate attempt was not found' USING ERRCODE = 'P0001';
    END IF;

    SELECT COALESCE(jsonb_agg(row_to_json(item)::jsonb ORDER BY item.exam_item_id), '[]'::jsonb)
    INTO response
    FROM (
        SELECT revision.exam_item_id,
               request_row.id AS evaluation_request_id,
               count(*) FILTER (WHERE unit.verdict = 'accepted')::integer AS passed_units,
               count(unit.id)::integer AS total_units
        FROM submission.evaluation_requests AS request_row
        JOIN submission.answer_revisions AS revision
          ON revision.tenant_id = request_row.tenant_id
         AND revision.id = request_row.answer_revision_id
        JOIN submission.judge_receipts AS receipt
          ON receipt.tenant_id = request_row.tenant_id
         AND receipt.evaluation_request_id = request_row.id
        LEFT JOIN submission.judge_receipt_units AS unit
          ON unit.tenant_id = receipt.tenant_id
         AND unit.judge_receipt_id = receipt.id
        WHERE request_row.tenant_id = p_tenant_id
          AND request_row.attempt_id = p_attempt_id
        -- Grouped by receipt as well, though it is not selected: judge_receipts
        -- is unique per judge event, not per evaluation request, so a cancelled
        -- request that received two distinct events would otherwise have both
        -- breakdowns summed into one inflated passed/total.
        GROUP BY revision.exam_item_id, request_row.id, receipt.id
    ) AS item;

    RETURN response;
END
$function$;

-- The reviewer view. It requires a capability signed for
-- submission.judge_receipts, which the canonical policy issues only to a
-- college-, department-, batch-, or platform-scoped role: a candidate's
-- self-scoped assignment cannot name this resource at all.
CREATE FUNCTION submission.list_attempt_unit_results(
    p_tenant_id uuid,
    p_attempt_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, submission, authz
AS $function$
DECLARE
    response jsonb;
BEGIN
    IF NOT authz.current_context_allows_read(
        p_tenant_id, 'submission.read', 'submission.write', 'submission.judge_receipts'
    ) THEN
        RAISE EXCEPTION 'signed authorization context does not allow this submission operation'
            USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM submission.attempts AS attempt
        WHERE attempt.tenant_id = p_tenant_id
          AND attempt.id = p_attempt_id
          AND attempt.deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'attempt was not found' USING ERRCODE = 'P0001';
    END IF;

    SELECT COALESCE(jsonb_agg(row_to_json(item)::jsonb ORDER BY item.exam_item_id), '[]'::jsonb)
    INTO response
    FROM (
        SELECT receipt.id AS judge_receipt_id,
               request_row.id AS evaluation_request_id,
               revision.exam_item_id,
               receipt.verdict,
               breakdown.passed_units,
               breakdown.total_units,
               breakdown.units
        FROM submission.evaluation_requests AS request_row
        JOIN submission.answer_revisions AS revision
          ON revision.tenant_id = request_row.tenant_id
         AND revision.id = request_row.answer_revision_id
        JOIN submission.judge_receipts AS receipt
          ON receipt.tenant_id = request_row.tenant_id
         AND receipt.evaluation_request_id = request_row.id
        CROSS JOIN LATERAL (
            SELECT count(*) FILTER (WHERE unit.verdict = 'accepted')::integer AS passed_units,
                   count(*)::integer AS total_units,
                   COALESCE(jsonb_agg(jsonb_build_object(
                       'unit_number', unit.unit_number,
                       'verdict', unit.verdict,
                       'execution_time_ms', unit.execution_time_ms,
                       'memory_kib', unit.memory_kib
                   ) ORDER BY unit.unit_number), '[]'::jsonb) AS units
            FROM submission.judge_receipt_units AS unit
            WHERE unit.tenant_id = receipt.tenant_id
              AND unit.judge_receipt_id = receipt.id
        ) AS breakdown
        WHERE request_row.tenant_id = p_tenant_id
          AND request_row.attempt_id = p_attempt_id
    ) AS item;

    RETURN response;
END
$function$;

REVOKE ALL ON FUNCTION submission.get_attempt_unit_summary_for_candidate(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION submission.list_attempt_unit_results(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
    submission.get_attempt_unit_summary_for_candidate(uuid, uuid),
    submission.list_attempt_unit_results(uuid, uuid)
    TO aether_submission_app;

RESET ROLE;
