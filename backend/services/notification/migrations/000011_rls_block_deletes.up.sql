-- Enforce soft delete: block direct DELETE via RLS.
-- Existing signed_read/insert/update policies from 000002 remain intact.
-- The RESTRICTIVE block_delete policy AND-combines with them: false AND anything = false.
-- app.hard_delete() SECURITY DEFINER bypasses RLS entirely.

SET ROLE aether_notification_owner;

-- DELETE privilege already granted in 000002; repeated here for clarity/idempotency
GRANT DELETE ON notification.recipient_preferences TO aether_notification_app;
GRANT DELETE ON notification.notifications TO aether_notification_app;
GRANT DELETE ON notification.provider_idempotency_records TO aether_notification_app;

-- Replace the permissive signed_delete policies with restrictive total blocks
DROP POLICY IF EXISTS notification_recipient_preferences_signed_delete ON notification.recipient_preferences;
DROP POLICY IF EXISTS notification_notifications_signed_delete ON notification.notifications;
DROP POLICY IF EXISTS notification_provider_idempotency_records_signed_delete ON notification.provider_idempotency_records;

CREATE POLICY block_delete ON notification.recipient_preferences
    AS RESTRICTIVE
    FOR DELETE TO aether_notification_app
    USING (false);

CREATE POLICY block_delete ON notification.notifications
    AS RESTRICTIVE
    FOR DELETE TO aether_notification_app
    USING (false);

CREATE POLICY block_delete ON notification.provider_idempotency_records
    AS RESTRICTIVE
    FOR DELETE TO aether_notification_app
    USING (false);

COMMENT ON POLICY block_delete ON notification.recipient_preferences IS
    'RESTRICTIVE: blocks all DELETE for app role. Use app.hard_delete() SECURITY DEFINER for physical removal.';

COMMENT ON POLICY block_delete ON notification.notifications IS
    'RESTRICTIVE: blocks all DELETE for app role. Use app.hard_delete() SECURITY DEFINER for physical removal.';

COMMENT ON POLICY block_delete ON notification.provider_idempotency_records IS
    'RESTRICTIVE: blocks all DELETE for app role. Use app.hard_delete() SECURITY DEFINER for physical removal.';

RESET ROLE;
