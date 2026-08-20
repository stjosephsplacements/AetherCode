-- Question Bank is global-scope only. It consumes the common complete grant
-- snapshot but derives its local read/write projection solely from the
-- platform grant. Access stays closed until a targeted recovery batch is
-- completely verified.
SET ROLE aether_question_bank_owner;

CREATE TABLE authz.authorization_snapshot_inbox_messages (
    event_id uuid PRIMARY KEY,
    payload_sha256 bytea NOT NULL CHECK (octet_length(payload_sha256) = 32),
    occurred_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    processed_at timestamptz,
    last_error text
);
CREATE INDEX authorization_snapshot_inbox_pending_idx
    ON authz.authorization_snapshot_inbox_messages (received_at) WHERE processed_at IS NULL;

CREATE FUNCTION authz.apply_authorization_snapshot(
    p_actor_id uuid, p_authz_revision bigint, p_grants jsonb
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, authz AS $function$
DECLARE
    grant_item jsonb;
    parsed_kind text;
    parsed_tenant_id uuid;
    parsed_source_id uuid;
    parsed_expires_at timestamptz;
    platform_expires_at timestamptz;
    has_platform boolean := false;
    current_revision bigint;
BEGIN
    IF p_actor_id IS NULL OR p_authz_revision <= 0 OR jsonb_typeof(p_grants) <> 'array' THEN
        RAISE EXCEPTION 'principal, positive authorization revision, and grants array are required';
    END IF;
    SELECT authorization_row.authz_revision INTO current_revision
    FROM authz.actor_global_authorizations AS authorization_row
    WHERE authorization_row.actor_id = p_actor_id FOR UPDATE;
    IF FOUND AND current_revision >= p_authz_revision THEN RETURN false; END IF;
    FOR grant_item IN SELECT value FROM jsonb_array_elements(p_grants) LOOP
        IF jsonb_typeof(grant_item) <> 'object' THEN
            RAISE EXCEPTION 'authorization grant must be an object';
        END IF;
        parsed_kind := grant_item ->> 'grant_kind';
        BEGIN
            parsed_tenant_id := NULLIF(grant_item ->> 'tenant_id', '')::uuid;
            parsed_source_id := NULLIF(grant_item ->> 'grant_source_id', '')::uuid;
            parsed_expires_at := NULLIF(grant_item ->> 'expires_at', '')::timestamptz;
        EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
            RAISE EXCEPTION 'authorization grant contains an invalid UUID or timestamp';
        END;
        IF parsed_kind = 'platform'
           AND parsed_tenant_id = '00000000-0000-0000-0000-000000000000'::uuid
           AND parsed_source_id = '00000000-0000-0000-0000-000000000000'::uuid THEN
            IF has_platform THEN RAISE EXCEPTION 'authorization snapshot contains duplicate grants'; END IF;
            has_platform := true;
            platform_expires_at := parsed_expires_at;
        ELSIF parsed_kind = 'tenant' AND parsed_tenant_id IS NOT NULL AND parsed_tenant_id = parsed_source_id THEN
            CONTINUE;
        ELSIF parsed_kind = 'placement' AND parsed_tenant_id IS NOT NULL AND parsed_source_id IS NOT NULL THEN
            CONTINUE;
        ELSE
            RAISE EXCEPTION 'authorization grant has an invalid scope';
        END IF;
    END LOOP;
    PERFORM authz.apply_global_authorization(
        p_actor_id, p_authz_revision, has_platform, has_platform, has_platform, platform_expires_at
    );
    RETURN true;
END
$function$;

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

CREATE OR REPLACE FUNCTION authz.has_global_authorization_at(
    p_actor_id uuid, p_authz_revision bigint, p_require_write boolean
)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz AS $function$
    SELECT authz.authorization_projection_ready() AND EXISTS (
        SELECT 1 FROM authz.actor_global_authorizations AS authorization_row
        WHERE authorization_row.actor_id = p_actor_id
          AND authorization_row.authz_revision = p_authz_revision
          AND authorization_row.active
          AND (authorization_row.expires_at IS NULL OR authorization_row.expires_at > clock_timestamp())
          AND CASE WHEN p_require_write THEN authorization_row.can_write
                   ELSE authorization_row.can_read OR authorization_row.can_write END
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
       OR p_target_service <> 'question-bank' OR p_reason !~ '^[a-z][a-z0-9._-]{0,63}$' THEN
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
        'authz.grants_snapshot.resync_requested.question-bank.v1', 1, event_payload,
        extensions.digest(convert_to(event_payload::text, 'UTF8'), 'sha256'), event_occurred_at
    );
    RETURN p_resync_id;
END
$function$;

REVOKE ALL ON TABLE authz.authorization_snapshot_inbox_messages,
    authz.authorization_projection_resync_state, authz.authorization_projection_resync_items FROM PUBLIC;
REVOKE ALL ON FUNCTION authz.apply_authorization_snapshot(uuid, bigint, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION authz.authorization_projection_ready() FROM PUBLIC;
REVOKE ALL ON FUNCTION authz.begin_authorization_projection_resync(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authz.apply_authorization_snapshot(uuid, bigint, jsonb)
    TO aether_question_bank_projection_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON authz.authorization_snapshot_inbox_messages,
    authz.authorization_projection_resync_state, authz.authorization_projection_resync_items
    TO aether_question_bank_projection_worker;
GRANT EXECUTE ON FUNCTION authz.begin_authorization_projection_resync(uuid, uuid, text, text)
    TO aether_question_bank_projection_worker;

RESET ROLE;
