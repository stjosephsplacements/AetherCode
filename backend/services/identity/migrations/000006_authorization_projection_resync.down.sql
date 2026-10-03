SET ROLE aether_identity_owner;

CREATE OR REPLACE FUNCTION authz.has_tenant_authorization_at(
    p_actor_id uuid, p_tenant_id uuid, p_authz_revision bigint
)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz AS $function$
    SELECT EXISTS (
        SELECT 1 FROM authz.actor_tenant_authorizations AS grant_row
        WHERE grant_row.actor_id = p_actor_id AND grant_row.tenant_id = p_tenant_id
          AND grant_row.authz_revision = p_authz_revision AND grant_row.is_authorized
          AND (grant_row.expires_at IS NULL OR grant_row.expires_at > clock_timestamp())
    )
$function$;

CREATE OR REPLACE FUNCTION authz.current_global_context_allows(
    p_required_action text, p_required_resource text
)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz, app AS $function$
    SELECT p_required_action IS NOT NULL AND p_required_resource IS NOT NULL AND EXISTS (
        SELECT 1 FROM authz.request_contexts AS context
        JOIN authz.actor_tenant_authorizations AS grant_row
          ON grant_row.actor_id = context.actor_id
         AND grant_row.authz_revision = context.authz_revision
         AND grant_row.is_authorized AND grant_row.grant_kind = 'platform'
         AND (grant_row.expires_at IS NULL OR grant_row.expires_at > clock_timestamp())
        WHERE context.context_id = app.current_context_id()
          AND context.backend_pid = pg_backend_pid() AND context.transaction_id = txid_current()
          AND context.expires_at > clock_timestamp() AND context.tenant_id IS NULL
          AND context.action = p_required_action AND context.resource = p_required_resource
    )
$function$;

CREATE OR REPLACE FUNCTION authz.current_context_allows_placement(
    p_placement_department_id uuid, p_required_action text, p_required_resource text
)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz, app AS $function$
    SELECT p_placement_department_id IS NOT NULL AND p_required_action IS NOT NULL AND p_required_resource IS NOT NULL
       AND EXISTS (
            SELECT 1 FROM authz.request_contexts AS context
            JOIN authz.actor_tenant_authorizations AS grant_row
              ON grant_row.actor_id = context.actor_id
             AND grant_row.tenant_id = context.tenant_id
             AND grant_row.authz_revision = context.authz_revision
             AND grant_row.is_authorized
             AND (grant_row.expires_at IS NULL OR grant_row.expires_at > clock_timestamp())
            WHERE context.context_id = app.current_context_id()
              AND context.backend_pid = pg_backend_pid() AND context.transaction_id = txid_current()
              AND context.expires_at > clock_timestamp() AND context.tenant_id IS NOT NULL
              AND context.action = p_required_action AND context.resource = p_required_resource
              AND (grant_row.grant_kind = 'platform'
                  OR (grant_row.grant_kind = 'placement' AND grant_row.grant_source_id = p_placement_department_id))
       )
$function$;

CREATE OR REPLACE FUNCTION authz.current_context_actor_id()
RETURNS uuid LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz, app AS $function$
    SELECT context.actor_id FROM authz.request_contexts AS context
    WHERE context.context_id = app.current_context_id()
      AND context.backend_pid = pg_backend_pid() AND context.transaction_id = txid_current()
      AND context.expires_at > clock_timestamp()
      AND (context.tenant_id IS NULL OR authz.has_tenant_authorization_at(
            context.actor_id, context.tenant_id, context.authz_revision
      ))
    LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION authz.current_context_has_platform_access()
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz, app AS $function$
    SELECT EXISTS (
        SELECT 1 FROM authz.request_contexts AS context
        JOIN authz.actor_tenant_authorizations AS grant_row
          ON grant_row.actor_id = context.actor_id
         AND grant_row.authz_revision = context.authz_revision
         AND grant_row.is_authorized AND grant_row.grant_kind = 'platform'
         AND (grant_row.expires_at IS NULL OR grant_row.expires_at > clock_timestamp())
        WHERE context.context_id = app.current_context_id()
          AND context.backend_pid = pg_backend_pid() AND context.transaction_id = txid_current()
          AND context.expires_at > clock_timestamp()
    )
$function$;

CREATE OR REPLACE FUNCTION authz.current_context_valid_placement(p_placement_department_id uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz, app AS $function$
    SELECT p_placement_department_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM authz.request_contexts AS context
        JOIN authz.actor_tenant_authorizations AS grant_row
          ON grant_row.actor_id = context.actor_id
         AND grant_row.authz_revision = context.authz_revision
         AND grant_row.is_authorized
         AND (grant_row.expires_at IS NULL OR grant_row.expires_at > clock_timestamp())
        WHERE context.context_id = app.current_context_id()
          AND context.backend_pid = pg_backend_pid() AND context.transaction_id = txid_current()
          AND context.expires_at > clock_timestamp() AND context.tenant_id IS NOT NULL
          AND authz.has_tenant_authorization_at(context.actor_id, context.tenant_id, context.authz_revision)
          AND (grant_row.grant_kind = 'platform'
              OR (grant_row.grant_kind = 'placement' AND grant_row.grant_source_id = p_placement_department_id))
    )
$function$;

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
    IF p_tenant_id IS NOT NULL AND NOT authz.has_tenant_authorization_at(p_actor_id, p_tenant_id, p_authz_revision) THEN
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

REVOKE EXECUTE ON FUNCTION authz.begin_authorization_projection_resync(uuid, uuid, text, text)
    FROM aether_identity_projection_worker;
REVOKE EXECUTE ON FUNCTION authz.apply_authorization_snapshot(uuid, bigint, jsonb)
    FROM aether_identity_projection_worker;
REVOKE SELECT, INSERT, UPDATE, DELETE ON authz.authorization_snapshot_inbox_messages,
    authz.authorization_projection_resync_state, authz.authorization_projection_resync_items
    FROM aether_identity_projection_worker;
DROP FUNCTION authz.begin_authorization_projection_resync(uuid, uuid, text, text);
DROP FUNCTION authz.has_platform_authorization_at(uuid, bigint);
DROP FUNCTION authz.authorization_projection_ready();
DROP FUNCTION authz.apply_authorization_snapshot(uuid, bigint, jsonb);
DROP TABLE authz.authorization_projection_resync_items;
DROP TABLE authz.authorization_projection_resync_state;
DROP TABLE authz.authorization_snapshot_inbox_messages;
DROP TABLE authz.authorization_grants;
DROP TABLE authz.principal_authorization_revisions;

RESET ROLE;
