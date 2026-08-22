-- Revert email and sms channel support, restoring in_app-only constraint
-- and the corresponding upsert function guard.
SET ROLE aether_notification_owner;

ALTER TABLE notification.recipient_preferences
    DROP CONSTRAINT IF EXISTS recipient_preferences_channel_check;

ALTER TABLE notification.recipient_preferences
    ADD CONSTRAINT recipient_preferences_channel_check
        CHECK (channel IN ('email', 'in_app'));

CREATE OR REPLACE FUNCTION notification.upsert_own_recipient_preference(
    p_preference_id uuid,
    p_tenant_id uuid,
    p_channel text,
    p_enabled boolean,
    p_expected_version bigint
)
RETURNS TABLE (
    id uuid,
    tenant_id uuid,
    recipient_id uuid,
    channel text,
    enabled boolean,
    updated_at timestamptz,
    version bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz, notification
AS $function$
DECLARE actor_id uuid;
BEGIN
    actor_id := authz.current_context_actor_id();
    IF p_preference_id IS NULL OR p_tenant_id IS NULL OR actor_id IS NULL
       OR p_channel <> 'in_app' OR p_enabled IS NULL OR p_expected_version IS NULL
       OR p_expected_version < 0
       OR NOT authz.current_context_allows(
           p_tenant_id, 'notification.write', 'notification.recipient_preferences'
       )
    THEN
        RAISE EXCEPTION 'invalid or unauthorized notification preference request' USING ERRCODE = '42501';
    END IF;

    IF p_expected_version = 0 THEN
        RETURN QUERY
        INSERT INTO notification.recipient_preferences AS preference (
            id, tenant_id, recipient_id, channel, enabled
        ) VALUES (
            p_preference_id, p_tenant_id, actor_id, p_channel, p_enabled
        ) ON CONFLICT (tenant_id, recipient_id, channel) DO NOTHING
        RETURNING preference.id, preference.tenant_id, preference.recipient_id,
            preference.channel, preference.enabled, preference.updated_at, preference.version;
    ELSE
        RETURN QUERY
        UPDATE notification.recipient_preferences AS preference
        SET enabled = p_enabled,
            updated_at = clock_timestamp(),
            version = preference.version + 1
        WHERE preference.tenant_id = p_tenant_id
          AND preference.recipient_id = actor_id
          AND preference.channel = p_channel
          AND preference.version = p_expected_version
        RETURNING preference.id, preference.tenant_id, preference.recipient_id,
            preference.channel, preference.enabled, preference.updated_at, preference.version;
    END IF;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'notification preference version conflict' USING ERRCODE = 'P0001';
    END IF;
END
$function$;

RESET ROLE;
