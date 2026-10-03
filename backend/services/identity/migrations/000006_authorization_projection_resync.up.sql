-- Identity historically projected one tenant row at a time. Introduce the
-- same complete grant snapshot contract used by protected services, then
-- require a targeted manifest-verified bootstrap after any retention gap.
SET ROLE aether_identity_owner;

CREATE TABLE authz.principal_authorization_revisions (
    actor_id uuid PRIMARY KEY,
    authz_revision bigint NOT NULL CHECK (authz_revision > 0),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE authz.authorization_grants (
    actor_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    grant_kind text NOT NULL CHECK (grant_kind IN ('platform', 'tenant', 'placement')),
    grant_source_id uuid NOT NULL,
    authz_revision bigint NOT NULL CHECK (authz_revision > 0),
    expires_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (actor_id, tenant_id, grant_kind, grant_source_id),
    CHECK (
        (grant_kind = 'platform'
            AND tenant_id = '00000000-0000-0000-0000-000000000000'::uuid
            AND grant_source_id = '00000000-0000-0000-0000-000000000000'::uuid)
        OR (grant_kind = 'tenant' AND tenant_id = grant_source_id)
        OR grant_kind = 'placement'
    )
);
CREATE INDEX authorization_grants_revision_idx
    ON authz.authorization_grants (actor_id, authz_revision, tenant_id)
    WHERE expires_at IS NULL;

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
BEGIN
    IF p_actor_id IS NULL OR p_authz_revision <= 0 OR jsonb_typeof(p_grants) <> 'array' THEN
        RAISE EXCEPTION 'principal, positive authorization revision, and grants array are required';
    END IF;
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
        IF (parsed_kind = 'platform'
                AND parsed_tenant_id = '00000000-0000-0000-0000-000000000000'::uuid
                AND parsed_source_id = '00000000-0000-0000-0000-000000000000'::uuid)
           OR (parsed_kind = 'tenant' AND parsed_tenant_id IS NOT NULL AND parsed_tenant_id = parsed_source_id)
           OR (parsed_kind = 'placement' AND parsed_tenant_id IS NOT NULL AND parsed_source_id IS NOT NULL)
        THEN CONTINUE; END IF;
        RAISE EXCEPTION 'authorization grant has an invalid scope';
    END LOOP;
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_grants) AS item(value)
        GROUP BY value ->> 'grant_kind', value ->> 'tenant_id', value ->> 'grant_source_id'
        HAVING count(*) > 1
    ) THEN RAISE EXCEPTION 'authorization snapshot contains duplicate grants'; END IF;

    INSERT INTO authz.principal_authorization_revisions AS revision (actor_id, authz_revision)
    VALUES (p_actor_id, p_authz_revision)
    ON CONFLICT (actor_id) DO UPDATE
    SET authz_revision = EXCLUDED.authz_revision, updated_at = clock_timestamp()
    WHERE EXCLUDED.authz_revision > revision.authz_revision;
    IF NOT FOUND THEN RETURN false; END IF;
    DELETE FROM authz.authorization_grants WHERE actor_id = p_actor_id;
    FOR grant_item IN SELECT value FROM jsonb_array_elements(p_grants) LOOP
        parsed_kind := grant_item ->> 'grant_kind';
        parsed_tenant_id := (grant_item ->> 'tenant_id')::uuid;
        parsed_source_id := (grant_item ->> 'grant_source_id')::uuid;
        parsed_expires_at := NULLIF(grant_item ->> 'expires_at', '')::timestamptz;
        INSERT INTO authz.authorization_grants (
            actor_id, tenant_id, grant_kind, grant_source_id, authz_revision, expires_at
        ) VALUES (
            p_actor_id, parsed_tenant_id, parsed_kind, parsed_source_id, p_authz_revision, parsed_expires_at
        );
    END LOOP;
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

CREATE FUNCTION authz.has_platform_authorization_at(p_actor_id uuid, p_authz_revision bigint)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz AS $function$
    SELECT authz.authorization_projection_ready() AND EXISTS (
        SELECT 1 FROM authz.principal_authorization_revisions AS revision
        JOIN authz.authorization_grants AS grant_row
          ON grant_row.actor_id = revision.actor_id AND grant_row.authz_revision = revision.authz_revision
        WHERE revision.actor_id = p_actor_id AND revision.authz_revision = p_authz_revision
          AND grant_row.grant_kind = 'platform'
          AND (grant_row.expires_at IS NULL OR grant_row.expires_at > clock_timestamp())
    )
$function$;

CREATE OR REPLACE FUNCTION authz.has_tenant_authorization_at(
    p_actor_id uuid, p_tenant_id uuid, p_authz_revision bigint
)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz AS $function$
    SELECT authz.authorization_projection_ready() AND p_tenant_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM authz.principal_authorization_revisions AS revision
        JOIN authz.authorization_grants AS grant_row
          ON grant_row.actor_id = revision.actor_id AND grant_row.authz_revision = revision.authz_revision
        WHERE revision.actor_id = p_actor_id AND revision.authz_revision = p_authz_revision
          AND (grant_row.expires_at IS NULL OR grant_row.expires_at > clock_timestamp())
          AND (grant_row.grant_kind = 'platform' OR grant_row.tenant_id = p_tenant_id)
    )
$function$;

CREATE OR REPLACE FUNCTION authz.current_global_context_allows(
    p_required_action text, p_required_resource text
)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz, app AS $function$
    SELECT p_required_action IS NOT NULL AND p_required_resource IS NOT NULL
       AND EXISTS (
            SELECT 1 FROM authz.request_contexts AS context
            WHERE context.context_id = app.current_context_id()
              AND context.backend_pid = pg_backend_pid() AND context.transaction_id = txid_current()
              AND context.expires_at > clock_timestamp() AND context.tenant_id IS NULL
              AND context.action = p_required_action AND context.resource = p_required_resource
              AND authz.has_platform_authorization_at(context.actor_id, context.authz_revision)
       )
$function$;

CREATE OR REPLACE FUNCTION authz.current_context_allows_placement(
    p_placement_department_id uuid, p_required_action text, p_required_resource text
)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz, app AS $function$
    SELECT p_placement_department_id IS NOT NULL AND p_required_action IS NOT NULL AND p_required_resource IS NOT NULL
       AND EXISTS (
            SELECT 1 FROM authz.request_contexts AS context
            WHERE context.context_id = app.current_context_id()
              AND context.backend_pid = pg_backend_pid() AND context.transaction_id = txid_current()
              AND context.expires_at > clock_timestamp() AND context.tenant_id IS NOT NULL
              AND context.action = p_required_action AND context.resource = p_required_resource
              AND authz.has_tenant_authorization_at(context.actor_id, context.tenant_id, context.authz_revision)
              AND EXISTS (
                  SELECT 1 FROM authz.authorization_grants AS grant_row
                  WHERE grant_row.actor_id = context.actor_id AND grant_row.authz_revision = context.authz_revision
                    AND (grant_row.expires_at IS NULL OR grant_row.expires_at > clock_timestamp())
                    AND (grant_row.grant_kind = 'platform'
                        OR (grant_row.grant_kind = 'placement' AND grant_row.tenant_id = context.tenant_id
                            AND grant_row.grant_source_id = p_placement_department_id))
              )
       )
$function$;

CREATE OR REPLACE FUNCTION authz.current_context_actor_id()
RETURNS uuid LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz, app AS $function$
    SELECT context.actor_id FROM authz.request_contexts AS context
    WHERE context.context_id = app.current_context_id()
      AND context.backend_pid = pg_backend_pid() AND context.transaction_id = txid_current()
      AND context.expires_at > clock_timestamp()
      AND CASE WHEN context.tenant_id IS NULL
          THEN authz.has_platform_authorization_at(context.actor_id, context.authz_revision)
          ELSE authz.has_tenant_authorization_at(context.actor_id, context.tenant_id, context.authz_revision)
      END
    LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION authz.current_context_has_platform_access()
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz, app AS $function$
    SELECT EXISTS (
        SELECT 1 FROM authz.request_contexts AS context
        WHERE context.context_id = app.current_context_id()
          AND context.backend_pid = pg_backend_pid() AND context.transaction_id = txid_current()
          AND context.expires_at > clock_timestamp()
          AND authz.has_platform_authorization_at(context.actor_id, context.authz_revision)
    )
$function$;

CREATE OR REPLACE FUNCTION authz.current_context_valid_placement(p_placement_department_id uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz, app AS $function$
    SELECT p_placement_department_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM authz.request_contexts AS context
        WHERE context.context_id = app.current_context_id()
          AND context.backend_pid = pg_backend_pid() AND context.transaction_id = txid_current()
          AND context.expires_at > clock_timestamp() AND context.tenant_id IS NOT NULL
          AND authz.has_tenant_authorization_at(context.actor_id, context.tenant_id, context.authz_revision)
          AND EXISTS (
              SELECT 1 FROM authz.authorization_grants AS grant_row
              WHERE grant_row.actor_id = context.actor_id AND grant_row.authz_revision = context.authz_revision
                AND (grant_row.expires_at IS NULL OR grant_row.expires_at > clock_timestamp())
                AND (grant_row.grant_kind = 'platform'
                    OR (grant_row.grant_kind = 'placement' AND grant_row.tenant_id = context.tenant_id
                        AND grant_row.grant_source_id = p_placement_department_id))
          )
    )
$function$;

-- Global decisions were previously not checked against a local grant at
-- context creation. The complete projection is now the mandatory second
-- authorization factor for every signed context, including platform scope.
CREATE OR REPLACE FUNCTION authz.set_context(
    p_actor_id uuid, p_tenant_id uuid, p_authz_revision bigint, p_decision text,
    p_capability_id uuid, p_action text, p_resource text, p_issued_at timestamptz,
    p_expires_at timestamptz, p_key_id uuid, p_signature bytea
)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, authz, app, extensions AS $function$
DECLARE
    context_key authz.context_keys%ROWTYPE;
    expected_signature bytea;
    canonical_envelope text;
    context_id uuid;
    v_now timestamptz := clock_timestamp();
BEGIN
    IF p_actor_id IS NULL OR p_authz_revision <= 0 OR p_capability_id IS NULL OR p_key_id IS NULL
       OR p_signature IS NULL OR octet_length(p_signature) <> 32 OR p_decision <> 'allow'
       OR p_action !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'
       OR p_resource !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$'
       OR p_issued_at IS NULL OR p_expires_at IS NULL OR p_expires_at <= v_now
       OR p_issued_at > v_now + interval '1 second' OR p_issued_at < v_now - interval '5 seconds'
       OR p_expires_at > p_issued_at + interval '5 seconds' THEN
        RAISE EXCEPTION 'invalid signed authorization context' USING ERRCODE = '28000';
    END IF;
    SELECT key.* INTO context_key FROM authz.context_keys AS key
    WHERE key.key_id = p_key_id AND key.audience = current_database()
      AND key.not_before <= v_now AND key.not_after > v_now AND key.retired_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'authorization context key is unavailable' USING ERRCODE = '28000'; END IF;
    canonical_envelope := format(
        'aether-authz-context-v2|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s',
        current_database(), p_key_id, p_capability_id, p_actor_id, COALESCE(p_tenant_id::text, ''),
        p_authz_revision, p_decision, p_action, p_resource,
        to_char(p_issued_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        to_char(p_expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    );
    expected_signature := extensions.hmac(convert_to(canonical_envelope, 'UTF8'), context_key.key_material, 'sha256');
    IF expected_signature <> p_signature THEN RAISE EXCEPTION 'invalid signed authorization context' USING ERRCODE = '28000'; END IF;
    IF (p_tenant_id IS NOT NULL AND NOT authz.has_tenant_authorization_at(p_actor_id, p_tenant_id, p_authz_revision))
       OR (p_tenant_id IS NULL AND NOT authz.has_platform_authorization_at(p_actor_id, p_authz_revision)) THEN
        RAISE EXCEPTION 'local authorization projection is not current' USING ERRCODE = '28000';
    END IF;
    PERFORM authz.purge_expired_contexts(); PERFORM authz.purge_expired_capabilities();
    INSERT INTO authz.consumed_capabilities (capability_id, expires_at) VALUES (p_capability_id, p_expires_at)
    ON CONFLICT (capability_id) DO NOTHING;
    IF NOT FOUND THEN RAISE EXCEPTION 'authorization capability has already been consumed' USING ERRCODE = '28000'; END IF;
    context_id := extensions.gen_random_uuid();
    INSERT INTO authz.request_contexts (
        context_id, capability_id, backend_pid, transaction_id, actor_id, tenant_id, authz_revision,
        action, resource, issued_at, expires_at
    ) VALUES (
        context_id, p_capability_id, pg_backend_pid(), txid_current(), p_actor_id, p_tenant_id, p_authz_revision,
        p_action, p_resource, p_issued_at, p_expires_at
    ) ON CONFLICT (capability_id) DO NOTHING RETURNING authz.request_contexts.context_id INTO context_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'authorization capability has already been consumed' USING ERRCODE = '28000'; END IF;
    PERFORM set_config('app.authz_context_id', context_id::text, true);
END
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
       OR p_target_service <> 'identity' OR p_reason !~ '^[a-z][a-z0-9._-]{0,63}$' THEN
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
        'authz.grants_snapshot.resync_requested.identity.v1', 1, event_payload,
        extensions.digest(convert_to(event_payload::text, 'UTF8'), 'sha256'), event_occurred_at
    );
    RETURN p_resync_id;
END
$function$;

REVOKE ALL ON TABLE authz.principal_authorization_revisions, authz.authorization_grants,
    authz.authorization_snapshot_inbox_messages, authz.authorization_projection_resync_state,
    authz.authorization_projection_resync_items FROM PUBLIC;
REVOKE ALL ON FUNCTION authz.apply_authorization_snapshot(uuid, bigint, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION authz.authorization_projection_ready() FROM PUBLIC;
REVOKE ALL ON FUNCTION authz.has_platform_authorization_at(uuid, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION authz.begin_authorization_projection_resync(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authz.apply_authorization_snapshot(uuid, bigint, jsonb)
    TO aether_identity_projection_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON authz.authorization_snapshot_inbox_messages,
    authz.authorization_projection_resync_state, authz.authorization_projection_resync_items
    TO aether_identity_projection_worker;
GRANT EXECUTE ON FUNCTION authz.begin_authorization_projection_resync(uuid, uuid, text, text)
    TO aether_identity_projection_worker;

RESET ROLE;
