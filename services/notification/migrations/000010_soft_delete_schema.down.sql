-- File: services/notification/migrations/000010_soft_delete_schema.down.sql
SET ROLE aether_notification_owner;

-- Drop updated RLS policies and restore original ones

-- Recipient preferences
DROP POLICY IF EXISTS notification_recipient_preferences_signed_read ON notification.recipient_preferences;
CREATE POLICY notification_recipient_preferences_signed_read
    ON notification.recipient_preferences
    FOR SELECT
    TO aether_notification_app
    USING (
        authz.current_context_allows_read(
            tenant_id,
            'notification.read',
            'notification.write',
            'notification.recipient_preferences'
        )
    );

DROP POLICY IF EXISTS notification_recipient_preferences_owner_maintenance ON notification.recipient_preferences;
CREATE POLICY notification_recipient_preferences_owner_maintenance
    ON notification.recipient_preferences
    FOR ALL
    TO aether_notification_owner
    USING (true)
    WITH CHECK (true);

-- Notifications
DROP POLICY IF EXISTS notification_notifications_signed_read ON notification.notifications;
CREATE POLICY notification_notifications_signed_read
    ON notification.notifications
    FOR SELECT
    TO aether_notification_app
    USING (
        authz.current_context_allows_read(
            tenant_id,
            'notification.read',
            'notification.write',
            'notification.notifications'
        )
    );

DROP POLICY IF EXISTS notification_notifications_owner_maintenance ON notification.notifications;
CREATE POLICY notification_notifications_owner_maintenance
    ON notification.notifications
    FOR ALL
    TO aether_notification_owner
    USING (true)
    WITH CHECK (true);

-- Provider idempotency records
DROP POLICY IF EXISTS notification_provider_idempotency_records_signed_read ON notification.provider_idempotency_records;
CREATE POLICY notification_provider_idempotency_records_signed_read
    ON notification.provider_idempotency_records
    FOR SELECT
    TO aether_notification_app
    USING (
        authz.current_context_allows_read(
            tenant_id,
            'notification.read',
            'notification.write',
            'notification.provider_idempotency_records'
        )
    );

DROP POLICY IF EXISTS notification_provider_idempotency_records_owner_maintenance ON notification.provider_idempotency_records;
CREATE POLICY notification_provider_idempotency_records_owner_maintenance
    ON notification.provider_idempotency_records
    FOR ALL
    TO aether_notification_owner
    USING (true)
    WITH CHECK (true);

DROP FUNCTION IF EXISTS app.hard_delete;
DROP TABLE IF EXISTS app.hard_delete_audit_log;

ALTER TABLE notification.provider_idempotency_records
    DROP COLUMN IF EXISTS deleted_at,
    DROP COLUMN IF EXISTS deleted_by,
    DROP COLUMN IF EXISTS deletion_reason;

ALTER TABLE notification.notifications
    DROP COLUMN IF EXISTS deleted_at,
    DROP COLUMN IF EXISTS deleted_by,
    DROP COLUMN IF EXISTS deletion_reason;

ALTER TABLE notification.recipient_preferences
    DROP COLUMN IF EXISTS deleted_at,
    DROP COLUMN IF EXISTS deleted_by,
    DROP COLUMN IF EXISTS deletion_reason;

RESET ROLE;
