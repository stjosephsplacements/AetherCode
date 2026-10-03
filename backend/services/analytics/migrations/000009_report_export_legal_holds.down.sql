SET ROLE aether_analytics_owner;

DO $rollback_guard$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM analytics.legal_hold_projections
        WHERE active AND scope = 'tenant'
    ) OR EXISTS (
        SELECT 1
        FROM analytics.report_exports
        WHERE legal_hold
    ) THEN
        RAISE EXCEPTION
            'cannot roll back report export legal-hold protections while a tenant hold or held export exists';
    END IF;
END
$rollback_guard$;

DROP TRIGGER IF EXISTS report_exports_legal_hold_guard ON analytics.report_exports;
DROP FUNCTION IF EXISTS analytics.enforce_report_export_legal_hold();

CREATE OR REPLACE FUNCTION analytics.apply_legal_hold(
    p_tenant_id uuid, p_legal_hold_id uuid, p_scope text, p_subject_id uuid,
    p_active boolean, p_source_event_id uuid
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, analytics AS $function$
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
        IF NOT FOUND THEN
            RETURN;
        END IF;
    END IF;
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
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, analytics, authz, app, extensions AS $function$
DECLARE actor_id uuid; event_payload jsonb;
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
    INSERT INTO analytics.report_exports (id, tenant_id, requested_by, report_type, filters, lifecycle_state)
    VALUES (p_id, p_tenant_id, actor_id, p_report_type, p_filters, 'queued')
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
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, analytics, app AS $function$
DECLARE fact_count integer; export_count integer;
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
    WITH due AS (
        SELECT id
        FROM analytics.report_exports
        WHERE lifecycle_state = 'completed' AND expires_at <= clock_timestamp() AND NOT legal_hold
        ORDER BY expires_at
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    ), expired AS (
        UPDATE analytics.report_exports AS report
        SET lifecycle_state = 'expired', version = version + 1
        FROM due
        WHERE report.id = due.id
        RETURNING 1
    ) SELECT count(*) INTO export_count FROM expired;
    RETURN fact_count + export_count;
END
$function$;

REVOKE SELECT (
    id, tenant_id, requested_by, report_type, filters, lifecycle_state,
    requested_at, completed_at, expires_at, retention_until, legal_hold, version
) ON TABLE analytics.report_exports FROM aether_analytics_app;
GRANT SELECT ON TABLE analytics.report_exports TO aether_analytics_app;

DROP FUNCTION IF EXISTS analytics.current_tenant_report_export_legal_hold(uuid);
DROP FUNCTION IF EXISTS analytics.has_active_tenant_report_export_legal_hold(uuid);
DROP TABLE analytics.tenant_report_export_hold_states;

RESET ROLE;
