-- Tenant legal holds must preserve report-export objects as well as immutable
-- analytics event facts. The state row serializes an export request with a
-- concurrent hold transition, so a newly queued export cannot retain a stale
-- legal_hold=false cache after the hold commits.
SET ROLE aether_analytics_owner;

CREATE TABLE analytics.tenant_report_export_hold_states (
    tenant_id uuid PRIMARY KEY,
    active_tenant_hold boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0)
);

ALTER TABLE analytics.tenant_report_export_hold_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.tenant_report_export_hold_states FORCE ROW LEVEL SECURITY;
CREATE POLICY analytics_tenant_report_export_hold_states_owner_maintenance
    ON analytics.tenant_report_export_hold_states
    FOR ALL TO aether_analytics_owner
    USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE analytics.tenant_report_export_hold_states FROM PUBLIC;

-- Seed both existing holds and existing exports before application traffic can
-- use the new serialized state. A false row is intentional: it is the mutex
-- for a tenant that does not currently have a tenant-wide hold.
INSERT INTO analytics.tenant_report_export_hold_states (tenant_id, active_tenant_hold)
SELECT hold.tenant_id, bool_or(hold.active AND hold.scope = 'tenant')
FROM analytics.legal_hold_projections AS hold
GROUP BY hold.tenant_id
ON CONFLICT (tenant_id) DO UPDATE
SET active_tenant_hold = EXCLUDED.active_tenant_hold,
    updated_at = clock_timestamp(),
    version = analytics.tenant_report_export_hold_states.version + 1;

INSERT INTO analytics.tenant_report_export_hold_states (tenant_id)
SELECT DISTINCT report.tenant_id
FROM analytics.report_exports AS report
ON CONFLICT (tenant_id) DO NOTHING;

CREATE FUNCTION analytics.current_tenant_report_export_legal_hold(p_tenant_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, analytics
AS $function$
DECLARE
    active_hold boolean;
BEGIN
    IF p_tenant_id IS NULL THEN
        RAISE EXCEPTION 'tenant is required for report export legal hold lookup'
            USING ERRCODE = '22023';
    END IF;

    INSERT INTO analytics.tenant_report_export_hold_states (
        tenant_id, active_tenant_hold
    ) VALUES (
        p_tenant_id,
        EXISTS (
            SELECT 1
            FROM analytics.legal_hold_projections AS hold
            WHERE hold.tenant_id = p_tenant_id
              AND hold.active
              AND hold.scope = 'tenant'
        )
    ) ON CONFLICT (tenant_id) DO NOTHING;

    SELECT state.active_tenant_hold
    INTO active_hold
    FROM analytics.tenant_report_export_hold_states AS state
    WHERE state.tenant_id = p_tenant_id
    FOR SHARE;

    RETURN COALESCE(active_hold, false);
END
$function$;

-- This read-only helper is used by the row trigger after PostgreSQL has taken
-- the report row lock. It intentionally does not lock the tenant state: hold
-- application always locks tenant state before report rows, while the purge
-- and request paths acquire that same state lock before touching a report.
CREATE FUNCTION analytics.has_active_tenant_report_export_legal_hold(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, analytics
AS $function$
    SELECT COALESCE(
        (
            SELECT state.active_tenant_hold
            FROM analytics.tenant_report_export_hold_states AS state
            WHERE state.tenant_id = p_tenant_id
        ),
        EXISTS (
            SELECT 1
            FROM analytics.legal_hold_projections AS hold
            WHERE hold.tenant_id = p_tenant_id
              AND hold.active
              AND hold.scope = 'tenant'
        )
    )
$function$;

CREATE FUNCTION analytics.enforce_report_export_legal_hold()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, analytics
AS $function$
DECLARE
    active_hold boolean;
BEGIN
    active_hold := analytics.has_active_tenant_report_export_legal_hold(
        CASE WHEN TG_OP = 'DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END
    );

    IF TG_OP = 'DELETE' THEN
        IF active_hold OR OLD.legal_hold THEN
            RAISE EXCEPTION 'report export under a tenant legal hold cannot be deleted'
                USING ERRCODE = '55000';
        END IF;
        RETURN OLD;
    END IF;

    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
        RAISE EXCEPTION 'report export tenant cannot change' USING ERRCODE = '22023';
    END IF;
    IF NEW.legal_hold IS DISTINCT FROM OLD.legal_hold
       AND COALESCE(current_setting('app.analytics_report_export_hold_sync', true), '') <> '1'
    THEN
        RAISE EXCEPTION 'report export legal hold is projection-managed' USING ERRCODE = '42501';
    END IF;
    IF active_hold AND NOT NEW.legal_hold THEN
        RAISE EXCEPTION 'active tenant legal hold must be reflected on report export'
            USING ERRCODE = '55000';
    END IF;
    IF (active_hold OR OLD.legal_hold)
       AND NEW.lifecycle_state = 'expired'
       AND OLD.lifecycle_state <> 'expired'
    THEN
        RAISE EXCEPTION 'report export under a tenant legal hold cannot expire'
            USING ERRCODE = '55000';
    END IF;
    IF (active_hold OR OLD.legal_hold)
       AND (
           (OLD.object_key IS NOT NULL AND NEW.object_key IS DISTINCT FROM OLD.object_key)
           OR (OLD.checksum IS NOT NULL AND NEW.checksum IS DISTINCT FROM OLD.checksum)
           OR (
               OLD.encryption_key_reference IS NOT NULL
               AND NEW.encryption_key_reference IS DISTINCT FROM OLD.encryption_key_reference
           )
       )
    THEN
        RAISE EXCEPTION 'report export object reference cannot be removed or replaced under a tenant legal hold'
            USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS report_exports_legal_hold_guard ON analytics.report_exports;
CREATE TRIGGER report_exports_legal_hold_guard
    BEFORE UPDATE OR DELETE ON analytics.report_exports
    FOR EACH ROW EXECUTE FUNCTION analytics.enforce_report_export_legal_hold();

CREATE OR REPLACE FUNCTION analytics.apply_legal_hold(
    p_tenant_id uuid, p_legal_hold_id uuid, p_scope text, p_subject_id uuid,
    p_active boolean, p_source_event_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, analytics
AS $function$
DECLARE
    tenant_hold_active boolean;
BEGIN
    IF p_tenant_id IS NULL OR p_legal_hold_id IS NULL OR p_source_event_id IS NULL THEN
        RAISE EXCEPTION 'legal hold identifiers are required';
    END IF;

    IF p_active THEN
        IF NOT ((p_scope = 'tenant' AND p_subject_id IS NULL)
            OR (p_scope IN ('student', 'assessment', 'submission') AND p_subject_id IS NOT NULL)) THEN
            RAISE EXCEPTION 'legal hold scope is invalid';
        END IF;
        INSERT INTO analytics.legal_hold_projections (
            tenant_id, legal_hold_id, scope, subject_id, active, source_event_id, updated_at
        ) VALUES (
            p_tenant_id, p_legal_hold_id, p_scope, p_subject_id, true, p_source_event_id, clock_timestamp()
        ) ON CONFLICT (tenant_id, legal_hold_id) DO UPDATE
        SET scope = EXCLUDED.scope, subject_id = EXCLUDED.subject_id, active = true,
            source_event_id = EXCLUDED.source_event_id, updated_at = clock_timestamp();
    ELSE
        UPDATE analytics.legal_hold_projections
        SET active = false, source_event_id = p_source_event_id, updated_at = clock_timestamp()
        WHERE tenant_id = p_tenant_id AND legal_hold_id = p_legal_hold_id;
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM analytics.legal_hold_projections AS hold
        WHERE hold.tenant_id = p_tenant_id
          AND hold.active
          AND hold.scope = 'tenant'
    ) INTO tenant_hold_active;

    UPDATE analytics.tenant_report_export_hold_states AS state
    SET active_tenant_hold = tenant_hold_active,
        updated_at = clock_timestamp(),
        version = state.version + 1
    WHERE state.tenant_id = p_tenant_id
      AND state.active_tenant_hold IS DISTINCT FROM tenant_hold_active;

    PERFORM set_config('app.analytics_legal_hold_update', '1', true);
    UPDATE analytics.event_facts AS fact
    SET legal_hold = EXISTS (
        SELECT 1
        FROM analytics.legal_hold_projections AS hold
        WHERE hold.tenant_id = fact.tenant_id
          AND hold.active
          AND (hold.scope = 'tenant' OR hold.subject_id = fact.subject_id)
    )
    WHERE fact.tenant_id = p_tenant_id;

    -- Retention takes event-fact rows before tenant export state. Preserve
    -- that order here, then serialize the export flag refresh with a new
    -- request. A request that slipped in before this lock is visible to the
    -- following UPDATE; a request after this lock waits and reads its result.
    INSERT INTO analytics.tenant_report_export_hold_states (tenant_id)
    VALUES (p_tenant_id)
    ON CONFLICT (tenant_id) DO NOTHING;
    PERFORM 1
    FROM analytics.tenant_report_export_hold_states AS state
    WHERE state.tenant_id = p_tenant_id
    FOR UPDATE;

    SELECT EXISTS (
        SELECT 1
        FROM analytics.legal_hold_projections AS hold
        WHERE hold.tenant_id = p_tenant_id
          AND hold.active
          AND hold.scope = 'tenant'
    ) INTO tenant_hold_active;

    UPDATE analytics.tenant_report_export_hold_states AS state
    SET active_tenant_hold = tenant_hold_active,
        updated_at = clock_timestamp(),
        version = state.version + 1
    WHERE state.tenant_id = p_tenant_id
      AND state.active_tenant_hold IS DISTINCT FROM tenant_hold_active;

    PERFORM set_config('app.analytics_report_export_hold_sync', '1', true);
    UPDATE analytics.report_exports AS report
    SET legal_hold = tenant_hold_active,
        version = report.version + 1
    WHERE report.tenant_id = p_tenant_id
      AND report.legal_hold IS DISTINCT FROM tenant_hold_active;
END
$function$;

CREATE OR REPLACE FUNCTION analytics.request_report_export(
    p_id uuid, p_tenant_id uuid, p_report_type text, p_filters jsonb, p_event_id uuid
)
RETURNS TABLE (
    id uuid, tenant_id uuid, requested_by uuid, report_type text, filters jsonb,
    lifecycle_state text, requested_at timestamptz, expires_at timestamptz,
    retention_until timestamptz, legal_hold boolean, version bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, analytics, authz, app, extensions
AS $function$
DECLARE
    actor_id uuid;
    event_payload jsonb;
    tenant_hold_active boolean;
BEGIN
    IF p_id IS NULL OR p_tenant_id IS NULL OR p_event_id IS NULL
       OR p_report_type NOT IN ('student_progress', 'exam_results', 'batch_progress', 'placement_progress')
       OR jsonb_typeof(p_filters) <> 'object' OR pg_column_size(p_filters) > 65536
       OR NOT authz.current_context_allows(p_tenant_id, 'analytics.write', 'analytics.report_exports') THEN
        RAISE EXCEPTION 'report export request is not authorized or invalid' USING ERRCODE = '42501';
    END IF;
    actor_id := authz.current_context_actor_id();
    IF actor_id IS NULL THEN
        RAISE EXCEPTION 'report export request actor is unavailable' USING ERRCODE = '42501';
    END IF;

    tenant_hold_active := analytics.current_tenant_report_export_legal_hold(p_tenant_id);
    INSERT INTO analytics.report_exports (
        id, tenant_id, requested_by, report_type, filters, lifecycle_state, legal_hold
    ) VALUES (
        p_id, p_tenant_id, actor_id, p_report_type, p_filters, 'queued', tenant_hold_active
    )
    RETURNING report_exports.id, report_exports.tenant_id, report_exports.requested_by,
              report_exports.report_type, report_exports.filters, report_exports.lifecycle_state,
              report_exports.requested_at, report_exports.expires_at,
              report_exports.retention_until, report_exports.legal_hold, report_exports.version
    INTO id, tenant_id, requested_by, report_type, filters, lifecycle_state,
         requested_at, expires_at, retention_until, legal_hold, version;

    event_payload := jsonb_build_object(
        'report_export_id', p_id::text, 'tenant_id', p_tenant_id::text,
        'requested_by', actor_id::text, 'report_type', p_report_type, 'filters', p_filters
    );
    INSERT INTO app.outbox_events (
        event_id, tenant_id, aggregate_type, aggregate_id, event_type,
        schema_version, payload, payload_sha256, occurred_at, next_attempt_at
    ) VALUES (
        p_event_id, p_tenant_id, 'report_export', p_id, 'analytics.report_export.requested.v1',
        1, event_payload, extensions.digest(convert_to(event_payload::text, 'UTF8'), 'sha256'),
        clock_timestamp(), clock_timestamp()
    );
    RETURN NEXT;
END
$function$;

CREATE OR REPLACE FUNCTION analytics.purge_expired_retained_data(p_limit integer DEFAULT 1000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, analytics, app
AS $function$
DECLARE
    fact_count integer;
    export_count integer;
    candidate record;
    tenant_hold_active boolean;
BEGIN
    IF p_limit < 1 OR p_limit > 10000 THEN
        RAISE EXCEPTION 'retention purge limit must be between 1 and 10000';
    END IF;
    PERFORM set_config('app.analytics_retention_purge', '1', true);
    WITH due AS (
        SELECT id, occurred_at
        FROM analytics.event_facts
        WHERE retention_until <= clock_timestamp() AND NOT legal_hold
        ORDER BY retention_until, occurred_at
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    ), deleted AS (
        DELETE FROM analytics.event_facts AS fact
        USING due
        WHERE fact.id = due.id AND fact.occurred_at = due.occurred_at
        RETURNING 1
    ) SELECT count(*) INTO fact_count FROM deleted;

    export_count := 0;
    FOR candidate IN
        SELECT report.id, report.tenant_id
        FROM analytics.report_exports AS report
        WHERE report.lifecycle_state = 'completed'
          AND report.expires_at <= clock_timestamp()
          AND NOT report.legal_hold
        ORDER BY report.expires_at, report.id
        LIMIT p_limit
    LOOP
        -- Keep the lock order state -> report consistent with legal-hold
        -- application and export creation. A concurrent hold either commits
        -- before this shared lock (and skips expiry) or waits until this
        -- transaction has made the pre-hold expiry decision.
        tenant_hold_active := analytics.current_tenant_report_export_legal_hold(
            candidate.tenant_id
        );
        IF tenant_hold_active THEN
            CONTINUE;
        END IF;
        UPDATE analytics.report_exports AS report
        SET lifecycle_state = 'expired', version = report.version + 1
        WHERE report.id = candidate.id
          AND report.tenant_id = candidate.tenant_id
          AND report.lifecycle_state = 'completed'
          AND report.expires_at <= clock_timestamp()
          AND NOT report.legal_hold;
        IF FOUND THEN
            export_count := export_count + 1;
        END IF;
    END LOOP;
    RETURN fact_count + export_count;
END
$function$;

-- Backfill the cached flag after the helpers and trigger are installed. The
-- trigger permits this only through the projection-owned transaction setting.
SELECT set_config('app.analytics_report_export_hold_sync', '1', true);
UPDATE analytics.report_exports AS report
SET legal_hold = hold_state.active_tenant_hold,
    version = report.version + 1
FROM analytics.tenant_report_export_hold_states AS hold_state
WHERE hold_state.tenant_id = report.tenant_id
  AND report.legal_hold IS DISTINCT FROM hold_state.active_tenant_hold;

-- The HTTP app can read export state, but never encrypted object references.
-- A future India-resident export worker must use a dedicated role/function;
-- it is deliberately not invented by this migration.
REVOKE SELECT ON TABLE analytics.report_exports FROM aether_analytics_app;
GRANT SELECT (
    id, tenant_id, requested_by, report_type, filters, lifecycle_state,
    requested_at, completed_at, expires_at, retention_until, legal_hold, version
) ON TABLE analytics.report_exports TO aether_analytics_app;

REVOKE ALL ON FUNCTION analytics.current_tenant_report_export_legal_hold(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION analytics.has_active_tenant_report_export_legal_hold(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION analytics.enforce_report_export_legal_hold() FROM PUBLIC;
REVOKE ALL ON FUNCTION analytics.apply_legal_hold(uuid, uuid, text, uuid, boolean, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION analytics.request_report_export(uuid, uuid, text, jsonb, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION analytics.purge_expired_retained_data(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION analytics.apply_legal_hold(uuid, uuid, text, uuid, boolean, uuid)
    TO aether_analytics_projection_worker;
GRANT EXECUTE ON FUNCTION analytics.request_report_export(uuid, uuid, text, jsonb, uuid)
    TO aether_analytics_app;
GRANT EXECUTE ON FUNCTION analytics.purge_expired_retained_data(integer)
    TO aether_analytics_migrator;

RESET ROLE;
