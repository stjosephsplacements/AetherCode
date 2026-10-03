-- Rollback: remove restrictive block_delete and restore original signed_delete policies from 000002.

SET ROLE aether_notification_owner;

DROP POLICY IF EXISTS block_delete ON notification.recipient_preferences;
DROP POLICY IF EXISTS block_delete ON notification.notifications;
DROP POLICY IF EXISTS block_delete ON notification.provider_idempotency_records;

-- Restore original signed_delete policies (created by DO loop in 000002_domain.up.sql)
CREATE POLICY notification_recipient_preferences_signed_delete ON notification.recipient_preferences
    FOR DELETE TO aether_notification_app
    USING (authz.current_context_allows(tenant_id, 'notification.write', 'notification.recipient_preferences'));

CREATE POLICY notification_notifications_signed_delete ON notification.notifications
    FOR DELETE TO aether_notification_app
    USING (authz.current_context_allows(tenant_id, 'notification.write', 'notification.notifications'));

CREATE POLICY notification_provider_idempotency_records_signed_delete ON notification.provider_idempotency_records
    FOR DELETE TO aether_notification_app
    USING (authz.current_context_allows(tenant_id, 'notification.write', 'notification.provider_idempotency_records'));

RESET ROLE;
