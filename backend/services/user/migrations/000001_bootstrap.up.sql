-- The migration login must be a member of aether_user_owner.  Deployment
-- provisions all roles before this migration is applied.
SET ROLE aether_user_owner;

DO $bootstrap$
DECLARE
    required_role text;
    role_attributes record;
BEGIN
    FOREACH required_role IN ARRAY ARRAY[
        'aether_user_owner',
        'aether_user_migrator',
        'aether_user_app',
        'aether_user_authz_reader',
        'aether_user_projection_worker'
    ]
    LOOP
        SELECT rolsuper, rolbypassrls INTO role_attributes
        FROM pg_roles WHERE rolname = required_role;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'required database role % is missing', required_role;
        END IF;
        IF role_attributes.rolsuper OR role_attributes.rolbypassrls THEN
            RAISE EXCEPTION 'database role % must not be superuser or BYPASSRLS', required_role;
        END IF;
    END LOOP;
END
$bootstrap$;

CREATE SCHEMA IF NOT EXISTS extensions AUTHORIZATION aether_user_owner;
CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION aether_user_owner;
CREATE SCHEMA IF NOT EXISTS authz AUTHORIZATION aether_user_owner;
CREATE SCHEMA IF NOT EXISTS users AUTHORIZATION aether_user_owner;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

DO $extension_location$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_extension AS extension
        JOIN pg_namespace AS namespace ON namespace.oid = extension.extnamespace
        WHERE extension.extname = 'pgcrypto' AND namespace.nspname <> 'extensions'
    ) THEN
        RAISE EXCEPTION 'pgcrypto must be installed in the extensions schema';
    END IF;
END
$extension_location$;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO aether_user_migrator;
REVOKE ALL ON SCHEMA extensions, app, authz, users FROM PUBLIC;
DO $extension_schema_access$
BEGIN
    IF has_schema_privilege('aether_user_app', 'extensions', 'USAGE')
       OR has_schema_privilege('aether_user_authz_reader', 'extensions', 'USAGE')
       OR has_schema_privilege('aether_user_projection_worker', 'extensions', 'USAGE') THEN
        RAISE EXCEPTION 'runtime roles must not have USAGE on extensions schema';
    END IF;
END
$extension_schema_access$;
GRANT USAGE ON SCHEMA app, authz, users TO aether_user_app;
GRANT USAGE ON SCHEMA authz TO aether_user_authz_reader, aether_user_projection_worker;
GRANT USAGE ON SCHEMA users TO aether_user_authz_reader;

ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA authz REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA authz REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA authz REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA users REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA users REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA users REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

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
CREATE INDEX context_keys_active_audience_idx
    ON authz.context_keys (audience, not_before, not_after) WHERE retired_at IS NULL;

CREATE UNLOGGED TABLE authz.request_contexts (
    context_id uuid PRIMARY KEY,
    capability_id uuid NOT NULL UNIQUE,
    backend_pid integer NOT NULL,
    transaction_id bigint NOT NULL,
    actor_id uuid NOT NULL,
    tenant_id uuid,
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

CREATE TABLE authz.actor_tenant_authorizations (
    actor_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    authz_revision bigint NOT NULL CHECK (authz_revision > 0),
    is_authorized boolean NOT NULL,
    grant_kind text NOT NULL CHECK (grant_kind IN ('platform', 'tenant', 'placement', 'revoked')),
    grant_source_id uuid,
    expires_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (actor_id, tenant_id),
    CHECK (
        (is_authorized AND grant_kind IN ('platform', 'tenant', 'placement') AND grant_source_id IS NOT NULL)
        OR (NOT is_authorized AND grant_kind = 'revoked' AND grant_source_id IS NULL)
    )
);
CREATE INDEX actor_tenant_authorizations_revision_idx
    ON authz.actor_tenant_authorizations (actor_id, authz_revision, tenant_id) WHERE is_authorized;

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
        SELECT 1 FROM authz.actor_tenant_authorizations AS grant_row
        WHERE grant_row.actor_id = p_actor_id
          AND grant_row.tenant_id = p_tenant_id
          AND grant_row.authz_revision = p_authz_revision
          AND grant_row.is_authorized
          AND (grant_row.expires_at IS NULL OR grant_row.expires_at > clock_timestamp())
    )
$function$;

CREATE FUNCTION authz.current_context_valid(p_tenant_id uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz, app AS $function$
    SELECT p_tenant_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM authz.request_contexts AS context
        WHERE context.context_id = app.current_context_id()
          AND context.backend_pid = pg_backend_pid()
          AND context.transaction_id = txid_current()
          AND context.expires_at > clock_timestamp()
          AND context.tenant_id = p_tenant_id
          AND authz.has_tenant_authorization_at(context.actor_id, context.tenant_id, context.authz_revision)
    )
$function$;

CREATE FUNCTION authz.current_context_allows(
    p_tenant_id uuid, p_required_action text, p_required_resource text
) RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz, app AS $function$
    SELECT p_tenant_id IS NOT NULL
       AND p_required_action IS NOT NULL
       AND p_required_resource IS NOT NULL
       AND EXISTS (
            SELECT 1 FROM authz.request_contexts AS context
            WHERE context.context_id = app.current_context_id()
              AND context.backend_pid = pg_backend_pid()
              AND context.transaction_id = txid_current()
              AND context.expires_at > clock_timestamp()
              AND context.tenant_id = p_tenant_id
              AND context.action = p_required_action
              AND context.resource = p_required_resource
              AND authz.has_tenant_authorization_at(context.actor_id, context.tenant_id, context.authz_revision)
       )
$function$;

CREATE FUNCTION authz.current_global_context_allows(
    p_required_action text, p_required_resource text
) RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz, app AS $function$
    SELECT p_required_action IS NOT NULL
       AND p_required_resource IS NOT NULL
       AND EXISTS (
            SELECT 1 FROM authz.request_contexts AS context
            JOIN authz.actor_tenant_authorizations AS grant_row
              ON grant_row.actor_id = context.actor_id
             AND grant_row.authz_revision = context.authz_revision
             AND grant_row.is_authorized
             AND grant_row.grant_kind = 'platform'
             AND (grant_row.expires_at IS NULL OR grant_row.expires_at > clock_timestamp())
            WHERE context.context_id = app.current_context_id()
              AND context.backend_pid = pg_backend_pid()
              AND context.transaction_id = txid_current()
              AND context.expires_at > clock_timestamp()
              AND context.tenant_id IS NULL
              AND context.action = p_required_action
              AND context.resource = p_required_resource
       )
$function$;

CREATE FUNCTION authz.current_context_allows_placement(
    p_placement_department_id uuid, p_required_action text, p_required_resource text
) RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz, app AS $function$
    SELECT p_placement_department_id IS NOT NULL
       AND p_required_action IS NOT NULL
       AND p_required_resource IS NOT NULL
       AND EXISTS (
            SELECT 1 FROM authz.request_contexts AS context
            JOIN authz.actor_tenant_authorizations AS grant_row
              ON grant_row.actor_id = context.actor_id
             AND grant_row.tenant_id = context.tenant_id
             AND grant_row.authz_revision = context.authz_revision
             AND grant_row.is_authorized
             AND (grant_row.expires_at IS NULL OR grant_row.expires_at > clock_timestamp())
            WHERE context.context_id = app.current_context_id()
              AND context.backend_pid = pg_backend_pid()
              AND context.transaction_id = txid_current()
              AND context.expires_at > clock_timestamp()
              AND context.tenant_id IS NOT NULL
              AND context.action = p_required_action
              AND context.resource = p_required_resource
              AND (grant_row.grant_kind = 'platform' OR (grant_row.grant_kind = 'placement' AND grant_row.grant_source_id = p_placement_department_id))
       )
$function$;

CREATE FUNCTION authz.current_context_actor_id()
RETURNS uuid LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz, app AS $function$
    SELECT context.actor_id FROM authz.request_contexts AS context
    WHERE context.context_id = app.current_context_id()
      AND context.backend_pid = pg_backend_pid()
      AND context.transaction_id = txid_current()
      AND context.expires_at > clock_timestamp()
      AND (context.tenant_id IS NULL OR authz.has_tenant_authorization_at(context.actor_id, context.tenant_id, context.authz_revision))
    LIMIT 1
$function$;

CREATE FUNCTION authz.current_context_has_platform_access()
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz, app AS $function$
    SELECT EXISTS (
        SELECT 1 FROM authz.request_contexts AS context
        JOIN authz.actor_tenant_authorizations AS grant_row
          ON grant_row.actor_id = context.actor_id
         AND grant_row.authz_revision = context.authz_revision
         AND grant_row.is_authorized
         AND grant_row.grant_kind = 'platform'
         AND (grant_row.expires_at IS NULL OR grant_row.expires_at > clock_timestamp())
        WHERE context.context_id = app.current_context_id()
          AND context.backend_pid = pg_backend_pid()
          AND context.transaction_id = txid_current()
          AND context.expires_at > clock_timestamp()
    )
$function$;

CREATE FUNCTION authz.current_context_valid_placement(p_placement_department_id uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz, app AS $function$
    SELECT p_placement_department_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM authz.request_contexts AS context
        JOIN authz.actor_tenant_authorizations AS grant_row
          ON grant_row.actor_id = context.actor_id
         AND grant_row.authz_revision = context.authz_revision
         AND grant_row.is_authorized
         AND (grant_row.expires_at IS NULL OR grant_row.expires_at > clock_timestamp())
        WHERE context.context_id = app.current_context_id()
          AND context.backend_pid = pg_backend_pid()
          AND context.transaction_id = txid_current()
          AND context.expires_at > clock_timestamp()
          AND context.tenant_id IS NOT NULL
          AND authz.has_tenant_authorization_at(context.actor_id, context.tenant_id, context.authz_revision)
          AND (grant_row.grant_kind = 'platform' OR (grant_row.grant_kind = 'placement' AND grant_row.grant_source_id = p_placement_department_id))
    )
$function$;

CREATE FUNCTION authz.purge_expired_contexts(p_limit integer DEFAULT 100)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz AS $function$
DECLARE deleted_count integer;
BEGIN
    IF p_limit < 1 OR p_limit > 10000 THEN RAISE EXCEPTION 'p_limit must be between 1 and 10000'; END IF;
    WITH expired AS (
        SELECT context_id FROM authz.request_contexts
        WHERE expires_at <= clock_timestamp()
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
    p_actor_id uuid, p_tenant_id uuid, p_authz_revision bigint, p_is_authorized boolean,
    p_grant_kind text, p_grant_source_id uuid, p_expires_at timestamptz DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, authz AS $function$
BEGIN
    IF p_actor_id IS NULL OR p_tenant_id IS NULL OR p_authz_revision <= 0 THEN
        RAISE EXCEPTION 'actor, tenant, and positive authorization revision are required';
    END IF;
    INSERT INTO authz.actor_tenant_authorizations AS grant_row (
        actor_id, tenant_id, authz_revision, is_authorized, grant_kind, grant_source_id, expires_at
    ) VALUES (
        p_actor_id, p_tenant_id, p_authz_revision, p_is_authorized, p_grant_kind, p_grant_source_id, p_expires_at
    ) ON CONFLICT (actor_id, tenant_id) DO UPDATE SET
        authz_revision = EXCLUDED.authz_revision, is_authorized = EXCLUDED.is_authorized,
        grant_kind = EXCLUDED.grant_kind, grant_source_id = EXCLUDED.grant_source_id,
        expires_at = EXCLUDED.expires_at, updated_at = clock_timestamp()
    WHERE EXCLUDED.authz_revision >= grant_row.authz_revision;
END
$function$;

CREATE FUNCTION authz.set_context(
    p_actor_id uuid, p_tenant_id uuid, p_authz_revision bigint, p_decision text,
    p_capability_id uuid, p_action text, p_resource text, p_issued_at timestamptz, p_expires_at timestamptz,
    p_key_id uuid, p_signature bytea
) RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, authz, app, extensions AS $function$
DECLARE
    context_key authz.context_keys%ROWTYPE;
    expected_signature bytea;
    canonical_envelope text;
    context_id uuid;
    v_now timestamptz := clock_timestamp();
BEGIN
    IF p_actor_id IS NULL OR p_authz_revision <= 0 OR p_capability_id IS NULL OR p_key_id IS NULL OR p_signature IS NULL
       OR octet_length(p_signature) <> 32 OR p_decision <> 'allow'
       OR p_action !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'
       OR p_resource !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$'
       OR p_issued_at IS NULL OR p_expires_at IS NULL OR p_expires_at <= v_now
       OR p_issued_at > v_now + interval '1 second'
       OR p_issued_at < v_now - interval '5 seconds'
       OR p_expires_at > p_issued_at + interval '5 seconds'
    THEN RAISE EXCEPTION 'invalid signed authorization context' USING ERRCODE = '28000'; END IF;
    SELECT key.* INTO context_key FROM authz.context_keys AS key
    WHERE key.key_id = p_key_id AND key.audience = current_database()
      AND key.not_before <= v_now AND key.not_after > v_now AND key.retired_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'authorization context key is unavailable' USING ERRCODE = '28000'; END IF;
    canonical_envelope := format(
        'aether-authz-context-v2|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s',
        current_database(), p_key_id, p_capability_id, p_actor_id, COALESCE(p_tenant_id::text, ''), p_authz_revision,
        p_decision, p_action, p_resource,
        to_char(p_issued_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        to_char(p_expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    );
    expected_signature := extensions.hmac(convert_to(canonical_envelope, 'UTF8'), context_key.key_material, 'sha256');
    IF expected_signature <> p_signature THEN RAISE EXCEPTION 'invalid signed authorization context' USING ERRCODE = '28000'; END IF;
    IF p_tenant_id IS NOT NULL AND NOT authz.has_tenant_authorization_at(p_actor_id, p_tenant_id, p_authz_revision) THEN
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

REVOKE ALL ON TABLE authz.context_keys, authz.request_contexts, authz.actor_tenant_authorizations FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA authz FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.current_context_id() TO aether_user_app;
GRANT EXECUTE ON FUNCTION authz.set_context(uuid, uuid, bigint, text, uuid, text, text, timestamptz, timestamptz, uuid, bytea) TO aether_user_app;
GRANT EXECUTE ON FUNCTION authz.current_context_valid(uuid) TO aether_user_app;
GRANT EXECUTE ON FUNCTION authz.current_context_allows(uuid, text, text) TO aether_user_app;
GRANT EXECUTE ON FUNCTION authz.current_global_context_allows(text, text) TO aether_user_app;
GRANT EXECUTE ON FUNCTION authz.current_context_allows_placement(uuid, text, text) TO aether_user_app;
GRANT EXECUTE ON FUNCTION authz.current_context_actor_id() TO aether_user_app;
GRANT EXECUTE ON FUNCTION authz.current_context_has_platform_access() TO aether_user_app;
GRANT EXECUTE ON FUNCTION authz.current_context_valid_placement(uuid) TO aether_user_app;
GRANT EXECUTE ON FUNCTION authz.apply_tenant_authorization(uuid, uuid, bigint, boolean, text, uuid, timestamptz) TO aether_user_projection_worker;
GRANT SELECT ON authz.actor_tenant_authorizations TO aether_user_authz_reader;

RESET ROLE;
