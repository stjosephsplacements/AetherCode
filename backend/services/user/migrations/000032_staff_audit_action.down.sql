SET ROLE aether_user_owner;

CREATE OR REPLACE FUNCTION users.list_staff_audit(p_tenant_id uuid, p_before timestamptz, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, users, authz, app
AS $function$
BEGIN
    IF NOT authz.current_context_allows(p_tenant_id, 'user.read', 'users.staff_audit') THEN
        RAISE EXCEPTION 'signed authorization context does not allow reading the audit log' USING ERRCODE = '42501';
    END IF;
    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN
        RAISE EXCEPTION 'limit must be between 1 and 200' USING ERRCODE = '22023';
    END IF;
    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                   'occurred_at', entry.occurred_at, 'principal_id', entry.principal_id,
                   'service', entry.target_service, 'resource_type', entry.resource_type,
                   'resource_id', entry.resource_id, 'allowed', entry.allowed
               ) ORDER BY entry.occurred_at DESC, entry.id DESC)
        FROM (SELECT * FROM users.staff_audit
              WHERE tenant_id = p_tenant_id AND (p_before IS NULL OR occurred_at < p_before)
              ORDER BY occurred_at DESC, id DESC LIMIT p_limit) AS entry
    ), '[]'::jsonb);
END
$function$;

CREATE OR REPLACE FUNCTION users.record_staff_action(
    p_principal_id uuid, p_tenant_id uuid, p_target_service text, p_resource_type text, p_resource_id text, p_allowed boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, users
AS $function$
DECLARE
    event_payload jsonb;
BEGIN
    INSERT INTO users.staff_audit (principal_id, tenant_id, target_service, resource_type, resource_id, allowed)
    VALUES (p_principal_id, p_tenant_id, p_target_service, p_resource_type, left(p_resource_id, 200), p_allowed);
    IF p_tenant_id IS NOT NULL THEN
        event_payload := jsonb_build_object('allowed', p_allowed);
        INSERT INTO app.outbox_events (
            event_id, aggregate_type, aggregate_id, tenant_id, event_type, schema_version, payload, payload_sha256
        ) VALUES (
            extensions.gen_random_uuid(), 'principal', p_principal_id, p_tenant_id,
            'user.staff_audit_recorded.v1', 1, event_payload,
            extensions.digest(convert_to(event_payload::text, 'UTF8'), 'sha256')
        );
    END IF;
    IF random() < 0.001 THEN
        DELETE FROM users.staff_audit WHERE occurred_at < clock_timestamp() - interval '400 days';
    END IF;
END
$function$;

DROP FUNCTION users.record_staff_action(uuid, uuid, text, text, text, boolean, text);
ALTER TABLE users.staff_audit DROP COLUMN action;

RESET ROLE;
