-- Retention is an operational responsibility with a narrower identity than
-- request handling or projection consumption. A per-tenant state row also
-- serializes every legal-hold transition before a purge can lock and delete a
-- retained notification or delivery attempt.
SET ROLE aether_notification_owner;

CREATE TABLE notification.tenant_legal_hold_states (
    tenant_id uuid PRIMARY KEY,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE notification.tenant_legal_hold_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification.tenant_legal_hold_states FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_tenant_legal_hold_states_owner_maintenance
    ON notification.tenant_legal_hold_states
    FOR ALL TO aether_notification_owner
    USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE notification.tenant_legal_hold_states FROM PUBLIC;

-- Create a durable mutex row for both existing retention records and legal
-- holds. A false/empty row is intentional: it protects the first hold placed
-- for a tenant just as much as an already-active hold.
INSERT INTO notification.tenant_legal_hold_states (tenant_id)
SELECT tenant_id
FROM (
    SELECT tenant_id FROM notification.notifications
    UNION
    SELECT tenant_id FROM notification.delivery_attempts
    UNION
    SELECT tenant_id FROM notification.legal_hold_projections
) AS tenants
ON CONFLICT (tenant_id) DO NOTHING;

CREATE FUNCTION notification.lock_tenant_legal_hold_state(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, notification
AS $function$
BEGIN
    IF p_tenant_id IS NULL THEN
        RAISE EXCEPTION 'tenant is required for legal-hold serialization' USING ERRCODE = '22023';
    END IF;
    INSERT INTO notification.tenant_legal_hold_states (tenant_id)
    VALUES (p_tenant_id)
    ON CONFLICT (tenant_id) DO NOTHING;
    PERFORM 1
    FROM notification.tenant_legal_hold_states AS state
    WHERE state.tenant_id = p_tenant_id
    FOR UPDATE;
END
$function$;

CREATE FUNCTION notification.share_tenant_legal_hold_state(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, notification
AS $function$
BEGIN
    IF p_tenant_id IS NULL THEN
        RAISE EXCEPTION 'tenant is required for legal-hold serialization' USING ERRCODE = '22023';
    END IF;
    INSERT INTO notification.tenant_legal_hold_states (tenant_id)
    VALUES (p_tenant_id)
    ON CONFLICT (tenant_id) DO NOTHING;
    PERFORM 1
    FROM notification.tenant_legal_hold_states AS state
    WHERE state.tenant_id = p_tenant_id
    FOR SHARE;
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

    -- All mutations that can make a record legally retained acquire this lock
    -- before they touch record rows. The purge uses a shared lock first, then
    -- locks its candidate row, so no state-to-row / row-to-state cycle exists.
    PERFORM notification.lock_tenant_legal_hold_state(p_tenant_id);

    IF EXISTS (
        SELECT 1
        FROM notification.legal_hold_projections AS hold
        WHERE hold.legal_hold_id = p_legal_hold_id
          AND (
              hold.tenant_id IS DISTINCT FROM p_tenant_id
              OR hold.scope IS DISTINCT FROM p_scope
              OR hold.subject_id IS DISTINCT FROM p_subject_id
          )
    ) THEN
        RAISE EXCEPTION 'legal hold identity cannot change' USING ERRCODE = '22023';
    END IF;

    INSERT INTO notification.legal_hold_projections AS hold (
        legal_hold_id, tenant_id, scope, subject_id, status,
        source_event_id, source_occurred_at
    ) VALUES (
        p_legal_hold_id, p_tenant_id, p_scope, p_subject_id, p_status,
        p_source_event_id, p_occurred_at
    ) ON CONFLICT (legal_hold_id) DO UPDATE
    SET status = EXCLUDED.status,
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
        UPDATE notification.tenant_legal_hold_states AS state
        SET version = state.version + 1,
            updated_at = clock_timestamp()
        WHERE state.tenant_id = p_tenant_id;
        PERFORM notification.refresh_legal_hold_flags(p_tenant_id);
    END IF;
    RETURN COALESCE(applied, false);
END
$function$;

CREATE FUNCTION notification.purge_expired_retained_data(p_limit integer DEFAULT 1000)
RETURNS TABLE (
    deleted_notifications bigint,
    deleted_delivery_attempts bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, notification, app
AS $function$
DECLARE
    candidate record;
    locked_notification_id uuid;
    locked_delivery_id uuid;
    deleted_notification_count bigint := 0;
    deleted_delivery_count bigint := 0;
BEGIN
    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 10000 THEN
        RAISE EXCEPTION 'retention purge limit must be between 1 and 10000' USING ERRCODE = '22023';
    END IF;
    PERFORM set_config('app.allow_retention_purge', 'on', true);

    -- The first query only bounds the work. Each individual candidate is read
    -- again after its tenant state is shared-locked, which makes a hold that
    -- committed while this batch was waiting visible before deletion.
    FOR candidate IN
        SELECT due.kind, due.id, due.occurred_at, due.tenant_id
        FROM (
            SELECT
                'notification'::text AS kind,
                item.id,
                NULL::timestamptz AS occurred_at,
                item.tenant_id,
                item.retention_until,
                item.recipient_id,
                item.retention_subject_id
            FROM notification.notifications AS item
            WHERE item.retention_until <= clock_timestamp()
              AND NOT item.legal_hold
              AND item.lifecycle_state IN ('sent', 'partially_delivered', 'failed', 'cancelled')
              AND NOT notification.has_active_legal_hold(
                  item.tenant_id, item.recipient_id, item.retention_subject_id
              )
            UNION ALL
            SELECT
                'delivery_attempt'::text AS kind,
                attempt.id,
                attempt.occurred_at,
                attempt.tenant_id,
                attempt.retention_until,
                attempt.recipient_id,
                attempt.retention_subject_id
            FROM notification.delivery_attempts AS attempt
            WHERE attempt.retention_until <= clock_timestamp()
              AND NOT attempt.legal_hold
              AND NOT notification.has_active_legal_hold(
                  attempt.tenant_id, attempt.recipient_id, attempt.retention_subject_id
              )
        ) AS due
        ORDER BY due.retention_until, due.kind, due.id
        LIMIT p_limit
    LOOP
        PERFORM notification.share_tenant_legal_hold_state(candidate.tenant_id);

        IF candidate.kind = 'notification' THEN
            SELECT item.id
            INTO locked_notification_id
            FROM notification.notifications AS item
            WHERE item.id = candidate.id
              AND item.tenant_id = candidate.tenant_id
              AND item.retention_until <= clock_timestamp()
              AND NOT item.legal_hold
              AND item.lifecycle_state IN ('sent', 'partially_delivered', 'failed', 'cancelled')
              AND NOT notification.has_active_legal_hold(
                  item.tenant_id, item.recipient_id, item.retention_subject_id
              )
            FOR UPDATE SKIP LOCKED;
            IF NOT FOUND THEN
                CONTINUE;
            END IF;

            DELETE FROM notification.provider_idempotency_records AS provider_record
            WHERE provider_record.tenant_id = candidate.tenant_id
              AND provider_record.notification_id = locked_notification_id;
            DELETE FROM notification.notifications AS item
            WHERE item.id = locked_notification_id
              AND item.tenant_id = candidate.tenant_id
              AND NOT item.legal_hold
              AND NOT notification.has_active_legal_hold(
                  item.tenant_id, item.recipient_id, item.retention_subject_id
              );
            IF FOUND THEN
                deleted_notification_count := deleted_notification_count + 1;
            END IF;
        ELSE
            SELECT attempt.id
            INTO locked_delivery_id
            FROM notification.delivery_attempts AS attempt
            WHERE attempt.id = candidate.id
              AND attempt.occurred_at = candidate.occurred_at
              AND attempt.tenant_id = candidate.tenant_id
              AND attempt.retention_until <= clock_timestamp()
              AND NOT attempt.legal_hold
              AND NOT notification.has_active_legal_hold(
                  attempt.tenant_id, attempt.recipient_id, attempt.retention_subject_id
              )
            FOR UPDATE SKIP LOCKED;
            IF NOT FOUND THEN
                CONTINUE;
            END IF;

            DELETE FROM notification.delivery_attempts AS attempt
            WHERE attempt.id = locked_delivery_id
              AND attempt.occurred_at = candidate.occurred_at
              AND attempt.tenant_id = candidate.tenant_id
              AND NOT attempt.legal_hold
              AND NOT notification.has_active_legal_hold(
                  attempt.tenant_id, attempt.recipient_id, attempt.retention_subject_id
              );
            IF FOUND THEN
                deleted_delivery_count := deleted_delivery_count + 1;
            END IF;
        END IF;
    END LOOP;

    deleted_notifications := deleted_notification_count;
    deleted_delivery_attempts := deleted_delivery_count;
    RETURN NEXT;
END
$function$;

REVOKE ALL ON FUNCTION notification.lock_tenant_legal_hold_state(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION notification.share_tenant_legal_hold_state(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION notification.purge_expired_retained_data(integer) FROM PUBLIC;
-- The projection role already has EXECUTE on the legal-hold procedure; schema
-- usage is required for PostgreSQL to resolve that granted routine and does
-- not confer table access.
GRANT USAGE ON SCHEMA notification TO aether_notification_projection_worker;
GRANT USAGE ON SCHEMA notification TO aether_notification_retention_worker;
GRANT EXECUTE ON FUNCTION notification.purge_expired_retained_data(integer)
    TO aether_notification_retention_worker;

RESET ROLE;
