SET ROLE aether_analytics_owner;

DROP FUNCTION authz.current_context_covers_node(uuid);

DROP FUNCTION authz.set_context(uuid, uuid, bigint, text, uuid, text, text, uuid[], timestamptz, timestamptz, uuid, bytea);

CREATE FUNCTION authz.set_context(
    p_actor_id uuid, p_tenant_id uuid, p_authz_revision bigint, p_decision text,
    p_capability_id uuid, p_action text, p_resource text, p_issued_at timestamptz, p_expires_at timestamptz,
    p_key_id uuid, p_signature bytea
) RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER
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

ALTER TABLE authz.request_contexts DROP COLUMN nodes;

GRANT EXECUTE ON FUNCTION authz.set_context(uuid, uuid, bigint, text, uuid, text, text, timestamptz, timestamptz, uuid, bytea) TO aether_analytics_app;

RESET ROLE;
