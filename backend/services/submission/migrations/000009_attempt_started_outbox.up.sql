-- Publish a single analytics-safe fact only when start_attempt inserted a new
-- attempt. The candidate audit event remains append-only and has its own
-- application-generated UUIDv7; the outbox event always uses a distinct
-- UUIDv7 supplied by the application service.
SET ROLE aether_submission_owner;

CREATE UNIQUE INDEX outbox_events_attempt_started_once_idx
    ON app.outbox_events (tenant_id, aggregate_id)
    WHERE event_type = 'submission.attempt_started.v1';

CREATE FUNCTION submission.prepare_attempt_started_outbox_event(
    p_attempt_event_id uuid,
    p_outbox_event_id uuid,
    p_tenant_id uuid,
    p_attempt_id uuid
)
RETURNS TABLE (payload jsonb, occurred_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz, submission
AS $function$
#variable_conflict use_column
DECLARE
    attempt_record submission.attempts%ROWTYPE;
    actor_id uuid;
    event_payload jsonb;
BEGIN
    PERFORM submission.require_authorized_context(p_tenant_id, 'submission.write', 'submission.attempts');
    actor_id := authz.current_context_actor_id();
    IF p_attempt_event_id IS NULL OR p_outbox_event_id IS NULL OR p_tenant_id IS NULL
       OR p_attempt_id IS NULL OR p_attempt_event_id = p_outbox_event_id
       OR actor_id IS NULL
       OR substring(p_attempt_event_id::text FROM 15 FOR 1) <> '7'
       OR substring(p_outbox_event_id::text FROM 15 FOR 1) <> '7'
    THEN
        RAISE EXCEPTION 'attempt started outbox command is invalid' USING ERRCODE = '22023';
    END IF;

    -- A new command event is written by start_attempt only on the insertion
    -- branch. An idempotency replay receives a newly generated event ID that
    -- has no matching audit row, so this returns no row and emits nothing.
    SELECT attempt_row.* INTO attempt_record
    FROM submission.attempts AS attempt_row
    JOIN submission.attempt_events AS audit_event
      ON audit_event.tenant_id = attempt_row.tenant_id
     AND audit_event.attempt_id = attempt_row.id
    WHERE attempt_row.tenant_id = p_tenant_id
      AND attempt_row.id = p_attempt_id
      AND audit_event.id = p_attempt_event_id
      AND audit_event.actor_id = actor_id
      AND audit_event.event_type = 'submission.attempt.started.v1'
      AND audit_event.payload ->> 'attempt_id' = p_attempt_id::text
    FOR SHARE OF attempt_row;
    IF NOT FOUND THEN
        RETURN;
    END IF;
    IF attempt_record.started_at IS NULL THEN
        RAISE EXCEPTION 'started attempt has no start timestamp' USING ERRCODE = '23514';
    END IF;

    -- The partial unique index remains the database backstop if an operator
    -- or a future caller accidentally tries to publish the same attempt twice.
    IF EXISTS (
        SELECT 1
        FROM app.outbox_events AS outbox_event
        WHERE outbox_event.tenant_id = p_tenant_id
          AND outbox_event.aggregate_id = p_attempt_id
          AND outbox_event.event_type = 'submission.attempt_started.v1'
    ) THEN
        RETURN;
    END IF;

    event_payload := jsonb_build_object(
        'tenant_id', attempt_record.tenant_id,
        'attempt_id', attempt_record.id,
        'candidate_assignment_id', attempt_record.candidate_assignment_id,
        'candidate_id', attempt_record.candidate_id,
        'exam_id', attempt_record.exam_id,
        'exam_version_id', attempt_record.exam_version_id,
        'started_at', attempt_record.started_at
    );
    RETURN QUERY SELECT event_payload, attempt_record.started_at;
END
$function$;

REVOKE ALL ON FUNCTION submission.prepare_attempt_started_outbox_event(uuid, uuid, uuid, uuid)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submission.prepare_attempt_started_outbox_event(uuid, uuid, uuid, uuid)
    TO aether_submission_app;

RESET ROLE;
