-- File: services/notification/migrations/000010_soft_delete_schema.up.sql
SET ROLE aether_notification_owner;

-- Recipient preferences (user-scoped settings)
ALTER TABLE notification.recipient_preferences
    ADD COLUMN deleted_at timestamptz,
    ADD COLUMN deleted_by uuid,
    ADD COLUMN deletion_reason text;

CREATE INDEX recipient_preferences_deleted_at_idx ON notification.recipient_preferences (deleted_at) WHERE deleted_at IS NOT NULL;

-- Notifications (core notification records)
ALTER TABLE notification.notifications
    ADD COLUMN deleted_at timestamptz,
    ADD COLUMN deleted_by uuid,
    ADD COLUMN deletion_reason text;

CREATE INDEX notifications_deleted_at_idx ON notification.notifications (deleted_at) WHERE deleted_at IS NOT NULL;

-- Provider idempotency records (technical records, cascade with notification)
ALTER TABLE notification.provider_idempotency_records
    ADD COLUMN deleted_at timestamptz,
    ADD COLUMN deleted_by uuid,
    ADD COLUMN deletion_reason text;

CREATE INDEX provider_idempotency_records_deleted_at_idx ON notification.provider_idempotency_records (deleted_at) WHERE deleted_at IS NOT NULL;

-- Delivery attempts: append-only audit trail, no soft delete (protected by trigger)

CREATE TABLE IF NOT EXISTS app.hard_delete_audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name text NOT NULL, record_id uuid NOT NULL,
    deleted_by uuid NOT NULL, deletion_reason text NOT NULL CHECK (char_length(deletion_reason) > 0),
    deleted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX hard_delete_audit_log_table_idx ON app.hard_delete_audit_log (table_name, deleted_at DESC);

CREATE OR REPLACE FUNCTION app.hard_delete(
    p_table text, p_id uuid, p_actor uuid, p_reason text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
    v_schema text;
    v_table text;
    v_sql text;
BEGIN
    -- Validate inputs
    IF p_table IS NULL OR p_id IS NULL OR p_actor IS NULL OR coalesce(p_reason, '') = '' THEN
        RAISE EXCEPTION 'hard_delete: all parameters required (table, id, actor, reason)';
    END IF;

    -- Validate schema-qualified table format
    v_schema := split_part(p_table, '.', 1);
    v_table := split_part(p_table, '.', 2);
    IF v_schema = '' OR v_table = '' OR split_part(p_table, '.', 3) <> '' THEN
        RAISE EXCEPTION 'hard_delete: p_table must be schema-qualified (schema.table), got: %', p_table;
    END IF;

    -- Authorization note: app-layer Casbin check verifies super_admin before calling.
    -- This function is GRANT EXECUTE only to the service app role — no other roles can invoke it.
    -- The SECURITY DEFINER context bypasses RLS block_delete policies.

    -- Audit the hard delete
    INSERT INTO app.hard_delete_audit_log (table_name, record_id, deleted_by, deletion_reason, deleted_at)
    VALUES (p_table, p_id, p_actor, p_reason, clock_timestamp());

    -- Execute physical delete with properly quoted schema.table
    v_sql := format('DELETE FROM %I.%I WHERE id = $1', v_schema, v_table);
    EXECUTE v_sql USING p_id;

    RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION app.hard_delete TO aether_notification_app;

-- Update RLS policies to exclude soft-deleted records from normal queries

-- Recipient preferences
DROP POLICY IF EXISTS notification_recipient_preferences_signed_read ON notification.recipient_preferences;
CREATE POLICY notification_recipient_preferences_signed_read
    ON notification.recipient_preferences
    FOR SELECT
    TO aether_notification_app
    USING (
        deleted_at IS NULL
        AND authz.current_context_allows_read(
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
        deleted_at IS NULL
        AND authz.current_context_allows_read(
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
        deleted_at IS NULL
        AND authz.current_context_allows_read(
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

RESET ROLE;
