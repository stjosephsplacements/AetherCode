-- SEB material is security-sensitive: private authorization projections and
-- transaction-scoped GUCs are mandatory for every tenant-scoped operation.
SET ROLE aether_seb_owner;

DO $$
DECLARE expected_role text;
BEGIN
    FOREACH expected_role IN ARRAY ARRAY[
        'aether_seb_owner',
        'aether_seb_migrator',
        'aether_seb_app',
        'aether_seb_authz_reader',
        'aether_seb_projection_worker'
    ] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = expected_role) THEN
            RAISE EXCEPTION 'required role % is missing; provision database roles before migrations', expected_role;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = expected_role AND (rolsuper OR rolbypassrls)) THEN
            RAISE EXCEPTION 'role % must not be superuser or BYPASSRLS', expected_role;
        END IF;
    END LOOP;
END;
$$;
DO $$ BEGIN EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database()); END; $$;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA app AUTHORIZATION aether_seb_owner;
CREATE SCHEMA authz AUTHORIZATION aether_seb_owner;
CREATE SCHEMA seb AUTHORIZATION aether_seb_owner;
CREATE SCHEMA extensions AUTHORIZATION aether_seb_owner;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
REVOKE ALL ON SCHEMA app, authz, seb, extensions FROM PUBLIC;
DO $extension_schema_access$
BEGIN
    IF has_schema_privilege('aether_seb_app', 'extensions', 'USAGE')
       OR has_schema_privilege('aether_seb_authz_reader', 'extensions', 'USAGE')
       OR has_schema_privilege('aether_seb_projection_worker', 'extensions', 'USAGE') THEN
        RAISE EXCEPTION 'runtime roles must not have USAGE on extensions schema';
    END IF;
END
$extension_schema_access$;
GRANT USAGE ON SCHEMA app, authz, seb TO aether_seb_app;
GRANT USAGE ON SCHEMA authz TO aether_seb_authz_reader, aether_seb_projection_worker;

ALTER DEFAULT PRIVILEGES FOR ROLE aether_seb_owner IN SCHEMA app
    REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE aether_seb_owner IN SCHEMA authz
    REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE aether_seb_owner IN SCHEMA seb
    REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE TABLE app.outbox_events (
    id uuid PRIMARY KEY, tenant_id uuid, aggregate_type text NOT NULL CHECK (length(aggregate_type) BETWEEN 1 AND 120),
    aggregate_id uuid NOT NULL, event_type text NOT NULL CHECK (length(event_type) BETWEEN 1 AND 180),
    schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0), payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    trace_id text, occurred_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP, available_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    published_at timestamptz, publish_attempts integer NOT NULL DEFAULT 0 CHECK (publish_attempts >= 0),
    locked_at timestamptz, lock_token uuid, last_error text, CHECK ((locked_at IS NULL) = (lock_token IS NULL))
);
CREATE INDEX outbox_events_ready_idx ON app.outbox_events (available_at, occurred_at) WHERE published_at IS NULL;
CREATE INDEX outbox_events_tenant_idx ON app.outbox_events (tenant_id, occurred_at DESC) WHERE tenant_id IS NOT NULL;

CREATE TABLE app.inbox_messages (
    consumer_name text NOT NULL CHECK (length(consumer_name) BETWEEN 1 AND 120), message_id uuid NOT NULL, tenant_id uuid,
    event_type text NOT NULL CHECK (length(event_type) BETWEEN 1 AND 180), payload_checksum char(64) NOT NULL CHECK (payload_checksum ~* '^[0-9a-f]{64}$'),
    received_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP, processed_at timestamptz,
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0), last_error text,
    PRIMARY KEY (consumer_name, message_id)
);
CREATE INDEX inbox_messages_pending_idx ON app.inbox_messages (received_at) WHERE processed_at IS NULL;

CREATE TABLE app.idempotency_keys (
    tenant_id uuid, scope_key text GENERATED ALWAYS AS (COALESCE(tenant_id::text, 'global')) STORED,
    operation text NOT NULL CHECK (length(operation) BETWEEN 1 AND 160), idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 255),
    request_hash char(64) NOT NULL CHECK (request_hash ~* '^[0-9a-f]{64}$'), state text NOT NULL CHECK (state IN ('in_progress', 'completed', 'failed')),
    response_status integer CHECK (response_status BETWEEN 100 AND 599), response_body jsonb, response_object_key text,
    response_checksum char(64) CHECK (response_checksum IS NULL OR response_checksum ~* '^[0-9a-f]{64}$'),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at timestamptz, expires_at timestamptz NOT NULL,
    PRIMARY KEY (scope_key, operation, idempotency_key),
    CHECK ((state = 'in_progress' AND completed_at IS NULL) OR state IN ('completed', 'failed')),
    CHECK (response_object_key IS NULL OR length(response_object_key) > 0)
);
CREATE INDEX idempotency_keys_expiry_idx ON app.idempotency_keys (expires_at);

CREATE FUNCTION app.current_actor_id() RETURNS uuid LANGUAGE plpgsql STABLE SET search_path = pg_catalog AS $$
DECLARE raw_setting text;
BEGIN
    raw_setting := current_setting('app.actor_id', true);
    IF raw_setting IS NULL OR raw_setting !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN NULL; END IF;
    RETURN raw_setting::uuid;
EXCEPTION WHEN invalid_text_representation THEN RETURN NULL;
END; $$;
CREATE FUNCTION app.current_tenant_id() RETURNS uuid LANGUAGE plpgsql STABLE SET search_path = pg_catalog AS $$
DECLARE raw_setting text;
BEGIN
    raw_setting := current_setting('app.tenant_id', true);
    IF raw_setting IS NULL OR raw_setting !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN NULL; END IF;
    RETURN raw_setting::uuid;
EXCEPTION WHEN invalid_text_representation THEN RETURN NULL;
END; $$;
CREATE FUNCTION app.current_authz_revision() RETURNS bigint LANGUAGE plpgsql STABLE SET search_path = pg_catalog AS $$
DECLARE raw_setting text;
BEGIN
    raw_setting := current_setting('app.authz_revision', true);
    IF raw_setting IS NULL OR raw_setting !~ '^[1-9][0-9]{0,18}$' THEN RETURN NULL; END IF;
    RETURN raw_setting::bigint;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN NULL;
END; $$;

CREATE TABLE authz.actor_tenant_authorizations (
    actor_id uuid NOT NULL, tenant_id uuid NOT NULL, authz_revision bigint NOT NULL CHECK (authz_revision > 0),
    active boolean NOT NULL DEFAULT true, expires_at timestamptz, updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (actor_id, tenant_id)
);
CREATE INDEX actor_tenant_authorizations_tenant_idx ON authz.actor_tenant_authorizations (tenant_id, actor_id) WHERE active;
CREATE FUNCTION authz.has_tenant_access(requested_tenant_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, app, authz AS $$
    SELECT requested_tenant_id IS NOT NULL AND requested_tenant_id = app.current_tenant_id()
       AND EXISTS (
            SELECT 1 FROM authz.actor_tenant_authorizations authorization_row
            WHERE authorization_row.actor_id = app.current_actor_id() AND authorization_row.tenant_id = requested_tenant_id
              AND authorization_row.authz_revision = app.current_authz_revision() AND authorization_row.active
              AND (authorization_row.expires_at IS NULL OR authorization_row.expires_at > CURRENT_TIMESTAMP)
       );
$$;

-- This is the final, initial signed-context schema. The provisional GUC helpers
-- are removed before the RLS functions below are created, so no policy can trust
-- an application-set GUC by itself.
DROP FUNCTION authz.has_tenant_access(uuid);
DROP FUNCTION app.current_actor_id();
DROP FUNCTION app.current_tenant_id();
DROP FUNCTION app.current_authz_revision();

CREATE TABLE authz.context_keys (
    key_id uuid PRIMARY KEY,
    audience text NOT NULL CHECK (audience ~ '^[a-z][a-z0-9_]{0,62}$'),
    key_material bytea NOT NULL CHECK (octet_length(key_material) >= 32),
    not_before timestamptz NOT NULL,
    not_after timestamptz NOT NULL,
    retired_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (not_after > not_before),
    CHECK (retired_at IS NULL OR retired_at >= not_before)
);
CREATE INDEX context_keys_active_audience_idx ON authz.context_keys (audience, not_before, not_after)
    WHERE retired_at IS NULL;

CREATE UNLOGGED TABLE authz.request_contexts (
    context_id uuid PRIMARY KEY,
    capability_id uuid NOT NULL UNIQUE,
    backend_pid integer NOT NULL,
    transaction_id bigint NOT NULL,
    actor_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    authz_revision bigint NOT NULL CHECK (authz_revision > 0),
    action text NOT NULL CHECK (action ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'),
    resource text NOT NULL CHECK (resource ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$'),
    issued_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (expires_at > issued_at),
    CHECK (expires_at <= issued_at + interval '5 seconds')
);
CREATE INDEX request_contexts_expiry_idx ON authz.request_contexts (expires_at);

CREATE TABLE authz.consumed_capabilities (
    capability_id uuid PRIMARY KEY,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX consumed_capabilities_expiry_idx ON authz.consumed_capabilities (expires_at);

CREATE TABLE authz.projection_inbox_messages (
    message_id uuid PRIMARY KEY,
    event_type text NOT NULL CHECK (length(event_type) BETWEEN 1 AND 180),
    payload_checksum char(64) NOT NULL CHECK (payload_checksum ~* '^[0-9a-f]{64}$'),
    received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    processed_at timestamptz,
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    last_error text
);
CREATE INDEX projection_inbox_messages_pending_idx ON authz.projection_inbox_messages (received_at)
    WHERE processed_at IS NULL;

CREATE FUNCTION app.current_context_id()
RETURNS uuid LANGUAGE plpgsql STABLE SET search_path = pg_catalog AS $function$
DECLARE raw_context_id text;
BEGIN
    raw_context_id := current_setting('app.authz_context_id', true);
    IF raw_context_id IS NULL OR raw_context_id = '' THEN RETURN NULL; END IF;
    RETURN raw_context_id::uuid;
EXCEPTION WHEN invalid_text_representation THEN RETURN NULL;
END
$function$;

CREATE FUNCTION authz.has_tenant_authorization_at(p_actor_id uuid, p_tenant_id uuid, p_authz_revision bigint)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz AS $function$
    SELECT EXISTS (
        SELECT 1 FROM authz.actor_tenant_authorizations AS authorization_row
        WHERE authorization_row.actor_id = p_actor_id
          AND authorization_row.tenant_id = p_tenant_id
          AND authorization_row.authz_revision = p_authz_revision
          AND authorization_row.active
          AND (authorization_row.expires_at IS NULL OR authorization_row.expires_at > clock_timestamp())
    )
$function$;

CREATE FUNCTION authz.current_context_allows(p_tenant_id uuid, p_required_action text, p_required_resource text)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz, app AS $function$
    SELECT p_tenant_id IS NOT NULL AND p_required_action IS NOT NULL AND p_required_resource IS NOT NULL
       AND EXISTS (
            SELECT 1 FROM authz.request_contexts AS context
            WHERE context.context_id = app.current_context_id()
              AND context.backend_pid = pg_backend_pid()
              AND context.transaction_id = txid_current()
              AND context.tenant_id = p_tenant_id
              AND context.action = p_required_action
              AND context.resource = p_required_resource
              AND context.expires_at > clock_timestamp()
              AND authz.has_tenant_authorization_at(context.actor_id, context.tenant_id, context.authz_revision)
       )
$function$;

CREATE FUNCTION authz.current_context_allows_read(
    p_tenant_id uuid, p_read_action text, p_write_action text, p_required_resource text
)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz AS $function$
    SELECT authz.current_context_allows(p_tenant_id, p_read_action, p_required_resource)
        OR authz.current_context_allows(p_tenant_id, p_write_action, p_required_resource)
$function$;

CREATE FUNCTION authz.purge_expired_contexts(p_limit integer DEFAULT 100)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz AS $function$
DECLARE deleted_count integer;
BEGIN
    IF p_limit < 1 OR p_limit > 10000 THEN RAISE EXCEPTION 'p_limit must be between 1 and 10000'; END IF;
    WITH expired AS (
        SELECT context_id FROM authz.request_contexts WHERE expires_at <= clock_timestamp()
        ORDER BY expires_at LIMIT p_limit FOR UPDATE SKIP LOCKED
    ), deleted AS (
        DELETE FROM authz.request_contexts AS context USING expired
        WHERE context.context_id = expired.context_id RETURNING 1
    ) SELECT count(*) INTO deleted_count FROM deleted;
    RETURN deleted_count;
END
$function$;

CREATE FUNCTION authz.purge_expired_capabilities(p_limit integer DEFAULT 100)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz AS $function$
DECLARE deleted_count integer;
BEGIN
    IF p_limit < 1 OR p_limit > 10000 THEN RAISE EXCEPTION 'p_limit must be between 1 and 10000'; END IF;
    WITH expired AS (
        SELECT capability_id FROM authz.consumed_capabilities WHERE expires_at <= clock_timestamp()
        ORDER BY expires_at LIMIT p_limit FOR UPDATE SKIP LOCKED
    ), deleted AS (
        DELETE FROM authz.consumed_capabilities AS capability USING expired
        WHERE capability.capability_id = expired.capability_id RETURNING 1
    ) SELECT count(*) INTO deleted_count FROM deleted;
    RETURN deleted_count;
END
$function$;

CREATE FUNCTION authz.apply_tenant_authorization(
    p_actor_id uuid, p_tenant_id uuid, p_authz_revision bigint, p_active boolean,
    p_expires_at timestamptz DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, authz AS $function$
BEGIN
    IF p_actor_id IS NULL OR p_tenant_id IS NULL OR p_authz_revision <= 0 THEN
        RAISE EXCEPTION 'actor, tenant, and positive authorization revision are required';
    END IF;
    INSERT INTO authz.actor_tenant_authorizations AS authorization_row (
        actor_id, tenant_id, authz_revision, active, expires_at, updated_at
    ) VALUES (p_actor_id, p_tenant_id, p_authz_revision, p_active, p_expires_at, clock_timestamp())
    ON CONFLICT (actor_id, tenant_id) DO UPDATE SET
        authz_revision = EXCLUDED.authz_revision,
        active = EXCLUDED.active,
        expires_at = EXCLUDED.expires_at,
        updated_at = clock_timestamp()
    WHERE EXCLUDED.authz_revision > authorization_row.authz_revision;
END
$function$;

CREATE FUNCTION authz.set_context(
    p_actor_id uuid, p_tenant_id uuid, p_authz_revision bigint, p_decision text,
    p_capability_id uuid, p_action text, p_resource text, p_issued_at timestamptz, p_expires_at timestamptz,
    p_key_id uuid, p_signature bytea
)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, authz, app, extensions AS $function$
DECLARE signing_key bytea; canonical_envelope text; context_id uuid; context_now timestamptz := clock_timestamp();
BEGIN
    IF p_actor_id IS NULL OR p_tenant_id IS NULL OR p_authz_revision <= 0 OR p_capability_id IS NULL OR p_key_id IS NULL
       OR p_signature IS NULL OR octet_length(p_signature) <> 32 OR p_decision <> 'allow'
       OR p_action !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'
       OR p_resource !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$'
       OR p_issued_at IS NULL OR p_expires_at IS NULL OR p_expires_at <= context_now
       OR p_issued_at > context_now + interval '1 second'
       OR p_issued_at < context_now - interval '5 seconds'
       OR p_expires_at > p_issued_at + interval '5 seconds' THEN
        RAISE EXCEPTION 'invalid signed authorization context' USING ERRCODE = '28000';
    END IF;
    SELECT key_material INTO signing_key FROM authz.context_keys
    WHERE key_id = p_key_id AND audience = current_database() AND not_before <= context_now
      AND not_after > context_now AND retired_at IS NULL;
    canonical_envelope := format(
        'aether-authz-context-v2|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s',
        current_database(), p_key_id, p_capability_id, p_actor_id, p_tenant_id, p_authz_revision, p_decision,
        p_action, p_resource,
        to_char(p_issued_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        to_char(p_expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    );
    IF signing_key IS NULL
       OR extensions.hmac(convert_to(canonical_envelope, 'UTF8'), signing_key, 'sha256') <> p_signature THEN
        RAISE EXCEPTION 'invalid signed authorization context' USING ERRCODE = '28000';
    END IF;
    IF NOT authz.has_tenant_authorization_at(p_actor_id, p_tenant_id, p_authz_revision) THEN
        RAISE EXCEPTION 'local authorization projection is not current' USING ERRCODE = '28000';
    END IF;
    PERFORM authz.purge_expired_contexts();
    PERFORM authz.purge_expired_capabilities();
    INSERT INTO authz.consumed_capabilities (capability_id, expires_at)
    VALUES (p_capability_id, p_expires_at)
    ON CONFLICT (capability_id) DO NOTHING;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'authorization capability has already been consumed' USING ERRCODE = '28000';
    END IF;
    context_id := extensions.gen_random_uuid();
    INSERT INTO authz.request_contexts (
        context_id, capability_id, backend_pid, transaction_id, actor_id, tenant_id, authz_revision,
        action, resource, issued_at, expires_at
    ) VALUES (
        context_id, p_capability_id, pg_backend_pid(), txid_current(), p_actor_id, p_tenant_id, p_authz_revision,
        p_action, p_resource, p_issued_at, p_expires_at
    ) ON CONFLICT (capability_id) DO NOTHING
    RETURNING authz.request_contexts.context_id INTO context_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'authorization capability has already been consumed' USING ERRCODE = '28000';
    END IF;
    PERFORM set_config('app.authz_context_id', context_id::text, true);
END
$function$;

REVOKE ALL ON ALL TABLES IN SCHEMA authz FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA authz FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.current_context_id() TO aether_seb_app;
GRANT EXECUTE ON FUNCTION authz.current_context_allows(uuid, text, text) TO aether_seb_app;
GRANT EXECUTE ON FUNCTION authz.current_context_allows_read(uuid, text, text, text) TO aether_seb_app;
GRANT EXECUTE ON FUNCTION authz.set_context(
    uuid, uuid, bigint, text, uuid, text, text, timestamptz, timestamptz, uuid, bytea
) TO aether_seb_app;
GRANT EXECUTE ON FUNCTION authz.apply_tenant_authorization(uuid, uuid, bigint, boolean, timestamptz)
    TO aether_seb_projection_worker;
GRANT SELECT ON authz.actor_tenant_authorizations TO aether_seb_authz_reader;
GRANT SELECT, INSERT, UPDATE, DELETE ON authz.projection_inbox_messages TO aether_seb_projection_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE app.outbox_events, app.inbox_messages, app.idempotency_keys TO aether_seb_app;

RESET ROLE;
