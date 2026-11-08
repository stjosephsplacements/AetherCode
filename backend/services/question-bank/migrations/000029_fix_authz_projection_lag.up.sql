SET ROLE aether_question_bank_owner;

-- Fix cascading 503 on service restart.
-- question-bank uses actor_global_authorizations (not actor_tenant_authorizations).

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
    DELETE FROM authz.authorization_projection_resync_items WHERE resync_id <> p_resync_id;
    UPDATE authz.authorization_projection_resync_state
    SET active_resync_id = p_resync_id, request_event_id = p_request_event_id,
        projection_ready = COALESCE(was_ready, false),
        requested_at = event_occurred_at, completion_event_id = NULL, expected_snapshot_count = NULL,
        expected_manifest_sha256 = NULL, completed_at = NULL, last_error = NULL, updated_at = event_occurred_at
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

CREATE OR REPLACE FUNCTION authz.has_global_authorization_at(
    p_actor_id uuid, p_authz_revision bigint, p_require_write boolean
)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz AS $function$
    SELECT authz.authorization_projection_ready() AND EXISTS (
        SELECT 1 FROM authz.actor_global_authorizations AS authorization_row
        WHERE authorization_row.actor_id = p_actor_id
          AND authorization_row.authz_revision >= GREATEST(1, p_authz_revision - 5)
          AND authorization_row.active
          AND (authorization_row.expires_at IS NULL OR authorization_row.expires_at > clock_timestamp())
          AND CASE WHEN p_require_write THEN authorization_row.can_write
                   ELSE authorization_row.can_read OR authorization_row.can_write END
    )
$function$;
