SET ROLE aether_user_owner;

ALTER TABLE authz.request_contexts ADD COLUMN nodes uuid[];

DROP FUNCTION authz.set_context(uuid, uuid, bigint, text, uuid, text, text, timestamptz, timestamptz, uuid, bytea);

CREATE FUNCTION authz.set_context(
    p_actor_id uuid, p_tenant_id uuid, p_authz_revision bigint, p_decision text,
    p_capability_id uuid, p_action text, p_resource text,
    p_nodes uuid[],
    p_issued_at timestamptz, p_expires_at timestamptz,
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
       OR array_length(p_nodes, 1) > 64
    THEN RAISE EXCEPTION 'invalid signed authorization context' USING ERRCODE = '28000'; END IF;
    SELECT key.* INTO context_key FROM authz.context_keys AS key
    WHERE key.key_id = p_key_id AND key.audience = current_database()
      AND key.not_before <= v_now AND key.not_after > v_now AND key.retired_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'authorization context key is unavailable' USING ERRCODE = '28000'; END IF;
    canonical_envelope := format(
        'aether-authz-context-v3|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s',
        current_database(), p_key_id, p_capability_id, p_actor_id, COALESCE(p_tenant_id::text, ''), p_authz_revision,
        p_decision, p_action, p_resource,
        array_to_string(COALESCE(p_nodes, '{}'), ','),
        to_char(p_issued_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        to_char(p_expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    );
    expected_signature := extensions.hmac(convert_to(canonical_envelope, 'UTF8'), context_key.key_material, 'sha256');
    IF expected_signature <> p_signature THEN RAISE EXCEPTION 'invalid signed authorization context' USING ERRCODE = '28000'; END IF;
    IF (p_tenant_id IS NOT NULL AND NOT authz.has_tenant_authorization_at(p_actor_id, p_tenant_id, p_authz_revision))
       OR (p_tenant_id IS NULL AND NOT authz.has_platform_authorization_at(p_actor_id, p_authz_revision)) THEN
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
        action, resource, nodes, issued_at, expires_at
    ) VALUES (
        context_id, p_capability_id, pg_backend_pid(), txid_current(), p_actor_id, p_tenant_id, p_authz_revision,
        p_action, p_resource, p_nodes, p_issued_at, p_expires_at
    ) ON CONFLICT (capability_id) DO NOTHING
    RETURNING authz.request_contexts.context_id INTO context_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'authorization capability has already been consumed' USING ERRCODE = '28000';
    END IF;
    PERFORM set_config('app.authz_context_id', context_id::text, true);
END
$function$;

CREATE FUNCTION authz.current_context_covers_node(p_node_id uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, authz, app AS $function$
    SELECT p_node_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM authz.request_contexts AS context
        WHERE context.context_id = app.current_context_id()
          AND context.backend_pid = pg_backend_pid()
          AND context.transaction_id = txid_current()
          AND context.expires_at > clock_timestamp()
          AND (context.nodes IS NULL OR p_node_id = ANY(context.nodes))
    )
$function$;

GRANT EXECUTE ON FUNCTION authz.set_context(uuid, uuid, bigint, text, uuid, text, text, uuid[], timestamptz, timestamptz, uuid, bytea) TO aether_user_app;
GRANT EXECUTE ON FUNCTION authz.current_context_covers_node(uuid) TO aether_user_app;

RESET ROLE;
