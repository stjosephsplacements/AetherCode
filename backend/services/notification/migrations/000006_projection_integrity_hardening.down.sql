SET ROLE aether_notification_owner;

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
       OR p_channel <> 'in_app' OR p_enabled IS NULL OR p_expected_version < 0
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

CREATE OR REPLACE FUNCTION notification.apply_legal_hold_projection(
    p_source_event_id uuid,
    p_legal_hold_id uuid,
    p_tenant_id uuid,
    p_scope text,
    p_subject_id uuid,
    p_status text,
    p_occurred_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, notification
AS $function$
DECLARE applied boolean;
BEGIN
    IF p_source_event_id IS NULL OR p_legal_hold_id IS NULL OR p_tenant_id IS NULL
       OR p_scope NOT IN ('tenant', 'student', 'assessment', 'submission')
       OR p_status NOT IN ('active', 'released') OR p_occurred_at IS NULL
       OR ((p_scope = 'tenant' AND p_subject_id IS NOT NULL)
           OR (p_scope <> 'tenant' AND p_subject_id IS NULL))
    THEN
        RAISE EXCEPTION 'invalid notification legal hold event';
    END IF;
    INSERT INTO notification.legal_hold_projections AS hold (
        legal_hold_id, tenant_id, scope, subject_id, status,
        source_event_id, source_occurred_at
    ) VALUES (
        p_legal_hold_id, p_tenant_id, p_scope, p_subject_id, p_status,
        p_source_event_id, p_occurred_at
    ) ON CONFLICT (legal_hold_id) DO UPDATE
    SET tenant_id = EXCLUDED.tenant_id,
        scope = EXCLUDED.scope,
        subject_id = EXCLUDED.subject_id,
        status = EXCLUDED.status,
        source_event_id = EXCLUDED.source_event_id,
        source_occurred_at = EXCLUDED.source_occurred_at,
        updated_at = clock_timestamp()
    WHERE EXCLUDED.source_occurred_at > hold.source_occurred_at
       OR (
           EXCLUDED.source_occurred_at = hold.source_occurred_at
           AND EXCLUDED.source_event_id::text > hold.source_event_id::text
       )
    RETURNING true INTO applied;
    IF COALESCE(applied, false) THEN
        PERFORM notification.refresh_legal_hold_flags(p_tenant_id);
    END IF;
    RETURN COALESCE(applied, false);
END
$function$;

RESET ROLE;
