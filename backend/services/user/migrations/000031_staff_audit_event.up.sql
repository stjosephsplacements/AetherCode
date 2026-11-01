-- Each college-scoped staff action also writes user.staff_audit_recorded.v1 to
-- the outbox in the same call (ADR-0050), so the staff console can refresh its
-- activity feed live. The payload carries only the decision; who did what stays
-- in users.staff_audit behind list_staff_audit's authorization.
SET ROLE aether_user_owner;

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

RESET ROLE;
