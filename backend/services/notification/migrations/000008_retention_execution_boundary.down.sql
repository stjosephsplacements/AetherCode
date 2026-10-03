SET ROLE aether_notification_owner;

DO $rollback_guard$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM notification.legal_hold_projections
        WHERE status = 'active'
    ) THEN
        RAISE EXCEPTION
            'cannot roll back Notification retention serialization while legal holds are active';
    END IF;
END
$rollback_guard$;

REVOKE EXECUTE ON FUNCTION notification.purge_expired_retained_data(integer)
    FROM aether_notification_retention_worker;
REVOKE USAGE ON SCHEMA notification FROM aether_notification_retention_worker;

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
        PERFORM notification.refresh_legal_hold_flags(p_tenant_id);
    END IF;
    RETURN COALESCE(applied, false);
END
$function$;

DROP FUNCTION IF EXISTS notification.purge_expired_retained_data(integer);
DROP FUNCTION IF EXISTS notification.share_tenant_legal_hold_state(uuid);
DROP FUNCTION IF EXISTS notification.lock_tenant_legal_hold_state(uuid);
DROP TABLE IF EXISTS notification.tenant_legal_hold_states;

RESET ROLE;
