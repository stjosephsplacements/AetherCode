-- The Judge completion bridge is a separate runtime identity. It cannot read
-- candidate tables or object storage; it can only call this narrow ingestion
-- routine after mTLS-delivered completion validation.
SET ROLE aether_submission_owner;

DO $roles$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aether_submission_judge_adapter') THEN
        RAISE EXCEPTION 'required role aether_submission_judge_adapter is missing; provision database roles before migrations';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM pg_roles
        WHERE rolname = 'aether_submission_judge_adapter'
          AND (rolsuper OR rolbypassrls)
    ) THEN
        RAISE EXCEPTION 'role aether_submission_judge_adapter must not be superuser or BYPASSRLS';
    END IF;
END
$roles$;

CREATE TABLE submission.judge_completion_ingress (
    judge_event_id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    evaluation_request_id uuid NOT NULL,
    judge_job_id uuid NOT NULL,
    verdict text NOT NULL CHECK (verdict IN (
        'accepted', 'wrong_answer', 'time_limit_exceeded', 'memory_limit_exceeded',
        'runtime_error', 'compile_error', 'internal_error', 'cancelled'
    )),
    execution_time_ms integer CHECK (execution_time_ms IS NULL OR execution_time_ms >= 0),
    memory_kib integer CHECK (memory_kib IS NULL OR memory_kib >= 0),
    result_object_key text,
    result_checksum char(64) CHECK (result_checksum IS NULL OR result_checksum ~ '^[0-9a-f]{64}$'),
    encryption_key_reference text,
    completed_at timestamptz NOT NULL,
    payload_sha256 bytea NOT NULL CHECK (octet_length(payload_sha256) = 32),
    outbox_event_id uuid NOT NULL UNIQUE REFERENCES app.outbox_events (event_id) ON DELETE RESTRICT,
    persisted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (tenant_id, evaluation_request_id)
        REFERENCES submission.evaluation_requests (tenant_id, id) ON DELETE RESTRICT,
    CHECK (
        (result_object_key IS NULL AND result_checksum IS NULL AND encryption_key_reference IS NULL)
        OR (result_object_key IS NOT NULL AND result_checksum IS NOT NULL AND encryption_key_reference IS NOT NULL)
    )
);
CREATE INDEX judge_completion_ingress_request_idx
    ON submission.judge_completion_ingress (tenant_id, evaluation_request_id, completed_at DESC);

CREATE TABLE submission.judge_completion_ingress_deliveries (
    delivery_id uuid PRIMARY KEY,
    judge_event_id uuid NOT NULL REFERENCES submission.judge_completion_ingress (judge_event_id) ON DELETE RESTRICT,
    lease_id uuid NOT NULL,
    consumer_id text NOT NULL CHECK (length(btrim(consumer_id)) BETWEEN 1 AND 255),
    persisted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (judge_event_id, lease_id)
);
CREATE INDEX judge_completion_ingress_deliveries_event_idx
    ON submission.judge_completion_ingress_deliveries (judge_event_id, persisted_at DESC);

ALTER TABLE submission.judge_completion_ingress ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission.judge_completion_ingress FORCE ROW LEVEL SECURITY;
ALTER TABLE submission.judge_completion_ingress_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission.judge_completion_ingress_deliveries FORCE ROW LEVEL SECURITY;

CREATE POLICY submission_judge_completion_ingress_owner_maintenance
    ON submission.judge_completion_ingress
    FOR ALL TO aether_submission_owner USING (true) WITH CHECK (true);
CREATE POLICY submission_judge_completion_ingress_deliveries_owner_maintenance
    ON submission.judge_completion_ingress_deliveries
    FOR ALL TO aether_submission_owner USING (true) WITH CHECK (true);

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

REVOKE ALL ON TABLE submission.judge_completion_ingress,
    submission.judge_completion_ingress_deliveries
FROM aether_submission_judge_adapter;
REVOKE ALL ON FUNCTION submission.ingest_judge_completion(
    uuid, uuid, uuid, uuid, text, uuid, uuid, text, integer, integer, text, text, text, timestamptz
) FROM PUBLIC;
GRANT USAGE ON SCHEMA submission TO aether_submission_judge_adapter;
GRANT EXECUTE ON FUNCTION submission.ingest_judge_completion(
    uuid, uuid, uuid, uuid, text, uuid, uuid, text, integer, integer, text, text, text, timestamptz
) TO aether_submission_judge_adapter;

RESET ROLE;
