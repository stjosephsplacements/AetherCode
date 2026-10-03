-- Notification workflows keep encrypted payload references in the database,
-- bind self-service preferences to the signed actor, and make delivery and
-- retention work durable without giving a background loop broad table access.
SET ROLE aether_notification_owner;

ALTER TABLE notification.notifications
    ADD COLUMN retention_subject_id uuid;
ALTER TABLE notification.delivery_attempts
    ADD COLUMN retention_subject_id uuid;
CREATE INDEX notifications_retention_subject_idx
    ON notification.notifications (tenant_id, retention_subject_id)
    WHERE retention_subject_id IS NOT NULL;

CREATE TABLE notification.tenant_retention_policies (
    tenant_id uuid PRIMARY KEY,
    notification_delivery_days integer NOT NULL CHECK (notification_delivery_days BETWEEN 30 AND 3650),
    policy_version integer NOT NULL CHECK (policy_version > 0),
    source_event_id uuid NOT NULL UNIQUE,
    source_occurred_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE notification.legal_hold_projections (
    legal_hold_id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    scope text NOT NULL CHECK (scope IN ('tenant', 'student', 'assessment', 'submission')),
    subject_id uuid,
    status text NOT NULL CHECK (status IN ('active', 'released')),
    source_event_id uuid NOT NULL UNIQUE,
    source_occurred_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK ((scope = 'tenant' AND subject_id IS NULL) OR (scope <> 'tenant' AND subject_id IS NOT NULL))
);
CREATE INDEX legal_hold_projections_active_idx
    ON notification.legal_hold_projections (tenant_id, scope, subject_id)
    WHERE status = 'active';

CREATE TABLE notification.projection_inbox_messages (
    consumer_name text NOT NULL CHECK (length(consumer_name) BETWEEN 1 AND 120),
    event_id uuid NOT NULL,
    payload_sha256 bytea NOT NULL CHECK (octet_length(payload_sha256) = 32),
    occurred_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    processed_at timestamptz,
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    last_error text,
    PRIMARY KEY (consumer_name, event_id)
);
CREATE INDEX notification_projection_inbox_pending_idx
    ON notification.projection_inbox_messages (received_at)
    WHERE processed_at IS NULL;

CREATE FUNCTION authz.current_context_actor_id()
RETURNS uuid
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, authz, app
AS $function$
    SELECT context.actor_id
    FROM authz.request_contexts AS context
    WHERE context.context_id = app.current_context_id()
      AND context.backend_pid = pg_backend_pid()
      AND context.transaction_id = txid_current()
      AND context.expires_at > clock_timestamp()
$function$;

CREATE FUNCTION notification.upsert_own_recipient_preference(
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

CREATE OR REPLACE FUNCTION notification.reject_delivery_attempt_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $function$
BEGIN
    IF current_setting('app.allow_retention_purge', true) = 'on' THEN
        RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' AND current_setting('app.allow_legal_hold_sync', true) = 'on' THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'delivery attempts are append-only' USING ERRCODE = '55000';
END
$function$;

CREATE FUNCTION notification.has_active_legal_hold(
    p_tenant_id uuid,
    p_recipient_id uuid,
    p_retention_subject_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, notification
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM notification.legal_hold_projections AS hold
        WHERE hold.tenant_id = p_tenant_id
          AND hold.status = 'active'
          AND (
              hold.scope = 'tenant'
              OR (hold.scope = 'student' AND hold.subject_id = p_recipient_id)
              OR (
                  hold.scope IN ('assessment', 'submission')
                  AND hold.subject_id = p_retention_subject_id
              )
          )
    )
$function$;

CREATE FUNCTION notification.refresh_legal_hold_flags(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, notification
AS $function$
BEGIN
    IF p_tenant_id IS NULL THEN
        RAISE EXCEPTION 'tenant is required for legal hold refresh';
    END IF;
    PERFORM set_config('app.allow_legal_hold_sync', 'on', true);
    UPDATE notification.notifications AS item
    SET legal_hold = notification.has_active_legal_hold(
        item.tenant_id, item.recipient_id, item.retention_subject_id
    )
    WHERE item.tenant_id = p_tenant_id
      AND item.legal_hold IS DISTINCT FROM notification.has_active_legal_hold(
          item.tenant_id, item.recipient_id, item.retention_subject_id
      );
    UPDATE notification.delivery_attempts AS attempt
    SET legal_hold = notification.has_active_legal_hold(
        attempt.tenant_id, attempt.recipient_id, attempt.retention_subject_id
    )
    WHERE attempt.tenant_id = p_tenant_id
      AND attempt.legal_hold IS DISTINCT FROM notification.has_active_legal_hold(
          attempt.tenant_id, attempt.recipient_id, attempt.retention_subject_id
      );
END
$function$;

CREATE FUNCTION notification.apply_retention_policy_projection(
    p_source_event_id uuid,
    p_tenant_id uuid,
    p_notification_delivery_days integer,
    p_policy_version integer,
    p_occurred_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, notification
AS $function$
DECLARE applied boolean;
BEGIN
    IF p_source_event_id IS NULL OR p_tenant_id IS NULL
       OR p_notification_delivery_days NOT BETWEEN 30 AND 3650
       OR p_policy_version <= 0 OR p_occurred_at IS NULL
    THEN
        RAISE EXCEPTION 'invalid notification retention policy event';
    END IF;
    INSERT INTO notification.tenant_retention_policies AS policy (
        tenant_id, notification_delivery_days, policy_version,
        source_event_id, source_occurred_at
    ) VALUES (
        p_tenant_id, p_notification_delivery_days, p_policy_version,
        p_source_event_id, p_occurred_at
    ) ON CONFLICT (tenant_id) DO UPDATE
    SET notification_delivery_days = EXCLUDED.notification_delivery_days,
        policy_version = EXCLUDED.policy_version,
        source_event_id = EXCLUDED.source_event_id,
        source_occurred_at = EXCLUDED.source_occurred_at,
        updated_at = clock_timestamp()
    WHERE EXCLUDED.policy_version > policy.policy_version
    RETURNING true INTO applied;
    RETURN COALESCE(applied, false);
END
$function$;

CREATE FUNCTION notification.apply_legal_hold_projection(
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

CREATE FUNCTION notification.deliver_due_in_app(p_limit integer DEFAULT 100)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, notification
AS $function$
DECLARE
    candidate notification.notifications%ROWTYPE;
    in_app_enabled boolean;
    delivered_count integer := 0;
    delivery_time timestamptz;
BEGIN
    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
        RAISE EXCEPTION 'delivery limit must be between 1 and 1000';
    END IF;
    FOR candidate IN
        SELECT *
        FROM notification.notifications
        WHERE lifecycle_state = 'pending'
          AND scheduled_at <= clock_timestamp()
        ORDER BY scheduled_at, id
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    LOOP
        SELECT preference.enabled INTO in_app_enabled
        FROM notification.recipient_preferences AS preference
        WHERE preference.tenant_id = candidate.tenant_id
          AND preference.recipient_id = candidate.recipient_id
          AND preference.channel = 'in_app';
        delivery_time := clock_timestamp();
        IF COALESCE(in_app_enabled, true) THEN
            INSERT INTO notification.delivery_attempts (
                id, occurred_at, tenant_id, notification_id, recipient_id,
                channel, provider, attempt_number, delivery_state,
                retention_until, legal_hold, retention_subject_id
            ) VALUES (
                candidate.id, delivery_time, candidate.tenant_id, candidate.id,
                candidate.recipient_id, 'in_app', 'in_app', 1, 'delivered',
                candidate.retention_until, candidate.legal_hold, candidate.retention_subject_id
            );
            UPDATE notification.notifications
            SET lifecycle_state = 'sent', completed_at = delivery_time, version = version + 1
            WHERE id = candidate.id AND tenant_id = candidate.tenant_id;
        ELSE
            INSERT INTO notification.delivery_attempts (
                id, occurred_at, tenant_id, notification_id, recipient_id,
                channel, provider, attempt_number, delivery_state, failure_code,
                retention_until, legal_hold, retention_subject_id
            ) VALUES (
                candidate.id, delivery_time, candidate.tenant_id, candidate.id,
                candidate.recipient_id, 'in_app', 'in_app', 1, 'suppressed', 'in_app_disabled',
                candidate.retention_until, candidate.legal_hold, candidate.retention_subject_id
            );
            UPDATE notification.notifications
            SET lifecycle_state = 'failed', completed_at = delivery_time, version = version + 1
            WHERE id = candidate.id AND tenant_id = candidate.tenant_id;
        END IF;
        delivered_count := delivered_count + 1;
    END LOOP;
    RETURN delivered_count;
END
$function$;

CREATE FUNCTION app.purge_expired_notifications(p_limit integer DEFAULT 10000)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, notification
AS $function$
DECLARE candidate record;
    deleted_count bigint := 0;
BEGIN
    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100000 THEN
        RAISE EXCEPTION 'purge limit must be between 1 and 100000';
    END IF;
    FOR candidate IN
        SELECT id, tenant_id
        FROM notification.notifications
        WHERE retention_until <= clock_timestamp()
          AND NOT legal_hold
          AND lifecycle_state IN ('sent', 'partially_delivered', 'failed', 'cancelled')
        ORDER BY retention_until, id
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    LOOP
        DELETE FROM notification.provider_idempotency_records
        WHERE tenant_id = candidate.tenant_id AND notification_id = candidate.id;
        DELETE FROM notification.notifications
        WHERE tenant_id = candidate.tenant_id AND id = candidate.id;
        IF FOUND THEN
            deleted_count := deleted_count + 1;
        END IF;
    END LOOP;
    RETURN deleted_count;
END
$function$;

-- Application callers cannot erase delivery/audit metadata directly. The
-- owner-only retention procedures are the sole delete path.
REVOKE DELETE ON TABLE notification.recipient_preferences,
    notification.notifications,
    notification.provider_idempotency_records,
    notification.delivery_attempts
FROM aether_notification_app;
REVOKE ALL ON TABLE notification.tenant_retention_policies,
    notification.legal_hold_projections,
    notification.projection_inbox_messages FROM PUBLIC;
REVOKE ALL ON FUNCTION authz.current_context_actor_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION notification.upsert_own_recipient_preference(uuid, uuid, text, boolean, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION notification.deliver_due_in_app(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION notification.apply_retention_policy_projection(uuid, uuid, integer, integer, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION notification.apply_legal_hold_projection(uuid, uuid, uuid, text, uuid, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.purge_expired_notifications(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authz.current_context_actor_id() TO aether_notification_app;
GRANT EXECUTE ON FUNCTION notification.upsert_own_recipient_preference(uuid, uuid, text, boolean, bigint)
    TO aether_notification_app;
GRANT EXECUTE ON FUNCTION notification.deliver_due_in_app(integer)
    TO aether_notification_app;
GRANT EXECUTE ON FUNCTION notification.apply_retention_policy_projection(uuid, uuid, integer, integer, timestamptz),
    notification.apply_legal_hold_projection(uuid, uuid, uuid, text, uuid, text, timestamptz)
    TO aether_notification_projection_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON notification.projection_inbox_messages
    TO aether_notification_projection_worker;

RESET ROLE;
