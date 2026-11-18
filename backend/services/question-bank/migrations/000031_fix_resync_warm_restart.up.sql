SET ROLE aether_question_bank_owner;

-- A ready service that starts another resync (a pod restart) keeps projection_ready = true, and the table's CHECK
-- requires a ready projection to have its completion recorded. The previous definition cleared the completion while
-- staying ready, which that CHECK rejects, so every warm restart failed. Keep the completion for a ready service and
-- clear it only on a cold start; the library replaces it when the new resync's completion arrives.
CREATE OR REPLACE FUNCTION authz.begin_authorization_projection_resync(
    p_request_event_id uuid, p_resync_id uuid, p_target_service text, p_reason text
)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, authz, app, extensions AS $function$
DECLARE
    event_payload jsonb;
    event_occurred_at timestamptz := clock_timestamp();
    was_ready boolean;
BEGIN
    IF p_request_event_id IS NULL OR p_resync_id IS NULL
       OR substring(p_request_event_id::text FROM 15 FOR 1) <> '7'
       OR substring(p_resync_id::text FROM 15 FOR 1) <> '7'
       OR p_target_service <> 'question-bank' OR p_reason !~ '^[a-z][a-z0-9._-]{0,63}$' THEN
        RAISE EXCEPTION 'invalid authorization projection resync request' USING ERRCODE = '22023';
    END IF;
    SELECT projection_ready AND (completed_at IS NOT NULL) INTO was_ready
    FROM authz.authorization_projection_resync_state WHERE singleton FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'authorization projection resync state is missing'; END IF;
    -- Taken after the row lock: a completion that commits while this call waited must not look newer than the request.
    event_occurred_at := clock_timestamp();
    DELETE FROM authz.authorization_projection_resync_items WHERE resync_id <> p_resync_id;
    UPDATE authz.authorization_projection_resync_state
    SET active_resync_id = p_resync_id, request_event_id = p_request_event_id,
        projection_ready = COALESCE(was_ready, false),
        requested_at = event_occurred_at,
        completion_event_id = CASE WHEN COALESCE(was_ready, false) THEN completion_event_id END,
        expected_snapshot_count = CASE WHEN COALESCE(was_ready, false) THEN expected_snapshot_count END,
        expected_manifest_sha256 = CASE WHEN COALESCE(was_ready, false) THEN expected_manifest_sha256 END,
        completed_at = CASE WHEN COALESCE(was_ready, false) THEN completed_at END,
        last_error = NULL, updated_at = event_occurred_at
    WHERE singleton;
    event_payload := jsonb_build_object('resync_id', p_resync_id, 'target_service', p_target_service, 'reason', p_reason);
    INSERT INTO app.outbox_events (
        event_id, aggregate_type, aggregate_id, tenant_id, event_type,
        schema_version, payload, payload_sha256, occurred_at
    ) VALUES (
        p_request_event_id, 'authz_resync', p_resync_id, NULL,
        'authz.grants_snapshot.resync_requested.question-bank.v1', 1, event_payload,
        extensions.digest(convert_to(event_payload::text, 'UTF8'), 'sha256'), event_occurred_at
    );
    RETURN p_resync_id;
END
$function$;

RESET ROLE;
