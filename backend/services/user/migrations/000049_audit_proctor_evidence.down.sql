SET ROLE aether_user_owner;

-- The permission-flag registry is append-only (trigger), so the six flags registered
-- by the up migration stay; they are inert without the route resources.
-- The older constraint cannot hold these rows; they are removed with the verb.
DELETE FROM users.staff_audit WHERE action = 'proctor.evidence.exported';
ALTER TABLE users.staff_audit DROP CONSTRAINT staff_audit_action_check;
ALTER TABLE users.staff_audit
    ADD CONSTRAINT staff_audit_action_check CHECK (action IN ('write', 'delete')) NOT VALID;
ALTER TABLE users.staff_audit VALIDATE CONSTRAINT staff_audit_action_check;

CREATE OR REPLACE FUNCTION users.record_staff_action(
    p_principal_id uuid, p_tenant_id uuid, p_target_service text, p_resource_type text, p_resource_id text, p_allowed boolean, p_action text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, users
AS $function$
DECLARE
    event_payload jsonb;
BEGIN
    IF p_action IS NULL OR p_action NOT IN ('write', 'delete') THEN
        RAISE EXCEPTION 'staff action must be write or delete' USING ERRCODE = '22023';
    END IF;
    INSERT INTO users.staff_audit (principal_id, tenant_id, target_service, resource_type, resource_id, allowed, action)
    VALUES (p_principal_id, p_tenant_id, p_target_service, p_resource_type, left(p_resource_id, 200), p_allowed, p_action);
    IF p_tenant_id IS NOT NULL THEN
        event_payload := jsonb_build_object('allowed', p_allowed, 'action', p_action);
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
