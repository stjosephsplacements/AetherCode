SET ROLE aether_notification_owner;

REVOKE EXECUTE ON FUNCTION notification.apply_retention_policy_projection(uuid, uuid, integer, integer, timestamptz),
    notification.apply_legal_hold_projection(uuid, uuid, uuid, text, uuid, text, timestamptz)
    FROM aether_notification_projection_worker;
REVOKE EXECUTE ON FUNCTION notification.deliver_due_in_app(integer)
    FROM aether_notification_app;
REVOKE EXECUTE ON FUNCTION notification.upsert_own_recipient_preference(uuid, uuid, text, boolean, bigint)
    FROM aether_notification_app;
REVOKE EXECUTE ON FUNCTION authz.current_context_actor_id() FROM aether_notification_app;
REVOKE SELECT, INSERT, UPDATE, DELETE ON notification.projection_inbox_messages
    FROM aether_notification_projection_worker;

DROP FUNCTION app.purge_expired_notifications(integer);
DROP FUNCTION notification.deliver_due_in_app(integer);
DROP FUNCTION notification.apply_legal_hold_projection(uuid, uuid, uuid, text, uuid, text, timestamptz);
DROP FUNCTION notification.apply_retention_policy_projection(uuid, uuid, integer, integer, timestamptz);
DROP FUNCTION notification.refresh_legal_hold_flags(uuid);
DROP FUNCTION notification.has_active_legal_hold(uuid, uuid, uuid);
DROP FUNCTION notification.upsert_own_recipient_preference(uuid, uuid, text, boolean, bigint);
DROP FUNCTION authz.current_context_actor_id();

DROP TRIGGER delivery_attempts_append_only ON notification.delivery_attempts;
DROP FUNCTION notification.reject_delivery_attempt_mutation();
CREATE FUNCTION notification.reject_delivery_attempt_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $function$
BEGIN
    IF current_setting('app.allow_retention_purge', true) = 'on' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'delivery attempts are append-only' USING ERRCODE = '55000';
END
$function$;
CREATE TRIGGER delivery_attempts_append_only
    BEFORE UPDATE OR DELETE ON notification.delivery_attempts
    FOR EACH ROW EXECUTE FUNCTION notification.reject_delivery_attempt_mutation();

DROP TABLE notification.projection_inbox_messages;
DROP TABLE notification.legal_hold_projections;
DROP TABLE notification.tenant_retention_policies;
DROP INDEX IF EXISTS notification.notifications_retention_subject_idx;
ALTER TABLE notification.delivery_attempts DROP COLUMN retention_subject_id;
ALTER TABLE notification.notifications DROP COLUMN retention_subject_id;

GRANT DELETE ON TABLE notification.recipient_preferences,
    notification.notifications,
    notification.provider_idempotency_records
TO aether_notification_app;

RESET ROLE;
