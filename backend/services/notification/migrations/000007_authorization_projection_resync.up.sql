-- Notification RLS must not trust a retained authorization snapshot after
-- the durable consumer has exceeded stream retention. Recovery uses a
-- targeted, manifest-verified batch and fails closed in the interim.
SET ROLE aether_notification_owner;

CREATE TABLE authz.authorization_projection_resync_state (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    active_resync_id uuid,
    request_event_id uuid,
    projection_ready boolean NOT NULL DEFAULT false,
    requested_at timestamptz,
    completion_event_id uuid,
    expected_snapshot_count integer,
    expected_manifest_sha256 bytea,
    completed_at timestamptz,
    last_error text,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK ((completion_event_id IS NULL AND expected_snapshot_count IS NULL AND expected_manifest_sha256 IS NULL)
        OR (completion_event_id IS NOT NULL AND expected_snapshot_count BETWEEN 0 AND 100000
            AND octet_length(expected_manifest_sha256) = 32)),
    CHECK (NOT projection_ready OR (active_resync_id IS NOT NULL AND completion_event_id IS NOT NULL
        AND expected_snapshot_count IS NOT NULL AND expected_manifest_sha256 IS NOT NULL))
);
INSERT INTO authz.authorization_projection_resync_state (singleton) VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE authz.authorization_projection_resync_items (
    resync_id uuid NOT NULL,
    principal_id uuid NOT NULL,
    authz_revision bigint NOT NULL CHECK (authz_revision > 0),
    snapshot_sha256 bytea NOT NULL CHECK (octet_length(snapshot_sha256) = 32),
    source_event_id uuid NOT NULL UNIQUE,
    received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (resync_id, principal_id)
);
CREATE INDEX authorization_projection_resync_items_received_idx
    ON authz.authorization_projection_resync_items (resync_id, received_at);

CREATE FUNCTION authz.authorization_projection_ready()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, authz AS $function$
    SELECT COALESCE((SELECT state.projection_ready
        FROM authz.authorization_projection_resync_state AS state WHERE state.singleton), false)
$function$;

CREATE OR REPLACE FUNCTION authz.has_tenant_authorization_at(
    p_actor_id uuid, p_tenant_id uuid, p_authz_revision bigint
)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz AS $function$
    SELECT authz.authorization_projection_ready() AND p_tenant_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM authz.actor_tenant_authorizations AS grant_row
        JOIN authz.principal_authorization_revisions AS revision
          ON revision.actor_id = grant_row.actor_id
         AND revision.authz_revision = grant_row.authz_revision
         AND revision.snapshot_applied
        WHERE grant_row.actor_id = p_actor_id AND grant_row.authz_revision = p_authz_revision
          AND grant_row.is_authorized
          AND (grant_row.expires_at IS NULL OR grant_row.expires_at > clock_timestamp())
          AND (grant_row.grant_kind = 'platform' OR grant_row.tenant_id = p_tenant_id)
    )
$function$;

CREATE FUNCTION authz.begin_authorization_projection_resync(
    p_request_event_id uuid, p_resync_id uuid, p_target_service text, p_reason text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, authz, app, extensions AS $function$
DECLARE event_payload jsonb; event_occurred_at timestamptz := clock_timestamp();
BEGIN
    IF p_request_event_id IS NULL OR p_resync_id IS NULL
       OR substring(p_request_event_id::text FROM 15 FOR 1) <> '7'
       OR substring(p_resync_id::text FROM 15 FOR 1) <> '7'
       OR p_target_service <> 'notification' OR p_reason !~ '^[a-z][a-z0-9._-]{0,63}$' THEN
        RAISE EXCEPTION 'invalid authorization projection resync request' USING ERRCODE = '22023';
    END IF;
    PERFORM 1 FROM authz.authorization_projection_resync_state WHERE singleton FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'authorization projection resync state is missing'; END IF;
    DELETE FROM authz.authorization_projection_resync_items WHERE resync_id <> p_resync_id;
    UPDATE authz.authorization_projection_resync_state
    SET active_resync_id = p_resync_id, request_event_id = p_request_event_id, projection_ready = false,
        requested_at = event_occurred_at, completion_event_id = NULL, expected_snapshot_count = NULL,
        expected_manifest_sha256 = NULL, completed_at = NULL, last_error = NULL, updated_at = event_occurred_at
    WHERE singleton;
    event_payload := jsonb_build_object('resync_id', p_resync_id, 'target_service', p_target_service, 'reason', p_reason);
    INSERT INTO app.outbox_events (
        event_id, aggregate_type, aggregate_id, tenant_id, event_type,
        schema_version, payload, payload_sha256, occurred_at
    ) VALUES (
        p_request_event_id, 'authz_resync', p_resync_id, NULL,
        'authz.grants_snapshot.resync_requested.notification.v1', 1, event_payload,
        extensions.digest(convert_to(event_payload::text, 'UTF8'), 'sha256'), event_occurred_at
    );
    RETURN p_resync_id;
END
$function$;

REVOKE ALL ON TABLE authz.authorization_projection_resync_state,
    authz.authorization_projection_resync_items FROM PUBLIC;
REVOKE ALL ON FUNCTION authz.authorization_projection_ready() FROM PUBLIC;
REVOKE ALL ON FUNCTION authz.begin_authorization_projection_resync(uuid, uuid, text, text) FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON authz.authorization_projection_resync_state,
    authz.authorization_projection_resync_items TO aether_notification_projection_worker;
GRANT EXECUTE ON FUNCTION authz.begin_authorization_projection_resync(uuid, uuid, text, text)
    TO aether_notification_projection_worker;

RESET ROLE;
