-- Analytics owns only local projections. Every mutable projection is fed by a
-- versioned event and is writable solely by the dedicated projection worker.
SET ROLE aether_analytics_owner;

ALTER TABLE analytics.exam_result_rollups
    DROP CONSTRAINT IF EXISTS exam_result_rollups_tenant_id_exam_version_id_candidate_id_key;
ALTER TABLE analytics.exam_result_rollups
    ADD COLUMN candidate_assignment_id uuid,
    ADD COLUMN attempt_number smallint CHECK (attempt_number IS NULL OR attempt_number BETWEEN 1 AND 20);

CREATE TABLE analytics.student_affiliation_projections (
    tenant_id uuid NOT NULL,
    student_id uuid NOT NULL,
    college_department_id uuid NOT NULL,
    placement_department_id uuid NOT NULL,
    source_event_id uuid NOT NULL,
    source_occurred_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (tenant_id, student_id)
);

CREATE TABLE analytics.exam_item_projections (
    tenant_id uuid NOT NULL,
    exam_item_id uuid NOT NULL,
    exam_version_id uuid NOT NULL,
    question_id uuid NOT NULL,
    question_version_id uuid NOT NULL,
    source_event_id uuid NOT NULL,
    source_occurred_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (tenant_id, exam_item_id)
);
CREATE INDEX exam_item_projections_question_idx
    ON analytics.exam_item_projections (tenant_id, question_id);

CREATE TABLE analytics.candidate_assignment_projections (
    tenant_id uuid NOT NULL,
    candidate_assignment_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    exam_id uuid NOT NULL,
    exam_version_id uuid NOT NULL,
    available_from timestamptz NOT NULL,
    available_until timestamptz NOT NULL,
    lifecycle_state text NOT NULL CHECK (lifecycle_state IN ('active', 'revoked')),
    source_revision bigint NOT NULL CHECK (source_revision > 0),
    source_event_id uuid NOT NULL,
    source_occurred_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (tenant_id, candidate_assignment_id),
    CHECK (available_from < available_until)
);
CREATE INDEX candidate_assignment_projections_candidate_idx
    ON analytics.candidate_assignment_projections (tenant_id, candidate_id, exam_version_id);

CREATE TABLE analytics.evaluation_projections (
    tenant_id uuid NOT NULL,
    evaluation_request_id uuid NOT NULL,
    attempt_id uuid NOT NULL,
    answer_revision_id uuid NOT NULL,
    exam_item_id uuid NOT NULL,
    maximum_score numeric(12,4) NOT NULL CHECK (maximum_score > 0),
    requested_event_id uuid NOT NULL,
    requested_at timestamptz NOT NULL,
    verdict text CHECK (verdict IN (
        'accepted', 'wrong_answer', 'time_limit_exceeded', 'memory_limit_exceeded',
        'runtime_error', 'compile_error', 'internal_error', 'cancelled'
    )),
    completion_event_id uuid UNIQUE,
    completed_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (tenant_id, evaluation_request_id),
    CHECK ((verdict IS NULL) = (completed_at IS NULL))
);
CREATE INDEX evaluation_projections_attempt_idx
    ON analytics.evaluation_projections (tenant_id, attempt_id);
CREATE INDEX evaluation_projections_exam_item_idx
    ON analytics.evaluation_projections (tenant_id, exam_item_id);

CREATE TABLE analytics.judge_completion_projections (
    tenant_id uuid NOT NULL,
    evaluation_request_id uuid NOT NULL,
    verdict text NOT NULL CHECK (verdict IN (
        'accepted', 'wrong_answer', 'time_limit_exceeded', 'memory_limit_exceeded',
        'runtime_error', 'compile_error', 'internal_error', 'cancelled'
    )),
    source_event_id uuid NOT NULL,
    completed_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (tenant_id, evaluation_request_id)
);

CREATE TABLE analytics.attempt_projections (
    tenant_id uuid NOT NULL,
    attempt_id uuid NOT NULL,
    candidate_assignment_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    exam_id uuid NOT NULL,
    exam_version_id uuid NOT NULL,
    attempt_number smallint NOT NULL CHECK (attempt_number BETWEEN 1 AND 20),
    lifecycle_state text NOT NULL CHECK (lifecycle_state = 'graded'),
    score numeric(12,4) NOT NULL CHECK (score >= 0),
    maximum_score numeric(12,4) NOT NULL CHECK (maximum_score > 0 AND score <= maximum_score),
    completed_at timestamptz NOT NULL,
    source_event_id uuid NOT NULL,
    source_occurred_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (tenant_id, attempt_id)
);
CREATE INDEX attempt_projections_candidate_idx
    ON analytics.attempt_projections (tenant_id, candidate_id, completed_at DESC);
CREATE INDEX attempt_projections_assignment_idx
    ON analytics.attempt_projections (tenant_id, candidate_assignment_id);

CREATE TABLE analytics.attempt_question_results (
    tenant_id uuid NOT NULL,
    attempt_id uuid NOT NULL,
    student_id uuid NOT NULL,
    question_id uuid NOT NULL,
    awarded_score numeric(12,4) NOT NULL CHECK (awarded_score >= 0),
    maximum_score numeric(12,4) NOT NULL CHECK (maximum_score > 0 AND awarded_score <= maximum_score),
    accepted boolean NOT NULL,
    completed_at timestamptz NOT NULL,
    PRIMARY KEY (tenant_id, attempt_id, question_id)
);
CREATE INDEX attempt_question_results_student_idx
    ON analytics.attempt_question_results (tenant_id, student_id, question_id, completed_at DESC);

CREATE TABLE analytics.legal_hold_projections (
    tenant_id uuid NOT NULL,
    legal_hold_id uuid NOT NULL,
    scope text NOT NULL CHECK (scope IN ('tenant', 'student', 'assessment', 'submission')),
    subject_id uuid,
    active boolean NOT NULL DEFAULT true,
    source_event_id uuid NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (tenant_id, legal_hold_id),
    CHECK ((scope = 'tenant' AND subject_id IS NULL) OR (scope <> 'tenant' AND subject_id IS NOT NULL))
);
CREATE INDEX legal_hold_projections_active_idx
    ON analytics.legal_hold_projections (tenant_id, scope, subject_id)
    WHERE active;

CREATE TABLE analytics.retention_policy_revisions (
    tenant_id uuid PRIMARY KEY,
    source_version integer NOT NULL CHECK (source_version > 0),
    source_event_id uuid NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE analytics.event_facts
    ADD COLUMN source_subject_type text NOT NULL DEFAULT 'unknown'
    CHECK (length(source_subject_type) BETWEEN 1 AND 80);

-- Delivery may resume after a short broker outage. Make the partition helper
-- able to provision an event's month, but keep it bounded to a realistic
-- analytics retention horizon so the worker cannot create arbitrary tables.
CREATE OR REPLACE FUNCTION app.ensure_analytics_event_fact_partitions(
    partition_through timestamptz DEFAULT (CURRENT_TIMESTAMP + interval '2 months')
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, app, analytics AS $function$
DECLARE
    partition_start timestamptz;
    partition_limit timestamptz;
    partition_end timestamptz;
    partition_name text;
BEGIN
    IF partition_through < CURRENT_TIMESTAMP - interval '8 years'
       OR partition_through > CURRENT_TIMESTAMP + interval '3 months' THEN
        RAISE EXCEPTION 'analytics partition target is outside the retained event horizon';
    END IF;
    partition_start := date_trunc('month', LEAST(CURRENT_TIMESTAMP, partition_through));
    partition_limit := date_trunc('month', GREATEST(CURRENT_TIMESTAMP + interval '2 months', partition_through));
    WHILE partition_start <= partition_limit LOOP
        partition_end := partition_start + interval '1 month';
        partition_name := format('event_facts_%s', to_char(partition_start, 'YYYYMM'));
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS analytics.%I PARTITION OF analytics.event_facts FOR VALUES FROM (%L) TO (%L)',
            partition_name, partition_start, partition_end
        );
        EXECUTE format(
            'CREATE INDEX IF NOT EXISTS %I ON analytics.%I (tenant_id, event_type, occurred_at DESC)',
            format('%s_tenant_event_idx', partition_name), partition_name
        );
        EXECUTE format(
            'CREATE INDEX IF NOT EXISTS %I ON analytics.%I (retention_until) WHERE NOT legal_hold',
            format('%s_retention_idx', partition_name), partition_name
        );
        partition_start := partition_end;
    END LOOP;
END
$function$;

CREATE OR REPLACE FUNCTION analytics.reject_event_fact_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $function$
BEGIN
    IF TG_OP = 'DELETE' AND current_setting('app.analytics_retention_purge', true) = '1' THEN
        RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' AND current_setting('app.analytics_legal_hold_update', true) = '1' THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'analytics event facts are append-only' USING ERRCODE = '55000';
END
$function$;

CREATE FUNCTION authz.current_context_actor_id()
RETURNS uuid LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, authz, app AS $function$
    SELECT context_row.actor_id
    FROM authz.request_contexts AS context_row
    WHERE context_row.context_id = app.current_context_id()
      AND context_row.backend_pid = pg_backend_pid()
      AND context_row.transaction_id = txid_current()
      AND context_row.expires_at > clock_timestamp()
$function$;

CREATE FUNCTION analytics.rebuild_student_placement(p_tenant_id uuid, p_student_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, analytics AS $function$
DECLARE
    affiliation_record analytics.student_affiliation_projections%ROWTYPE;
    latest_attempt analytics.attempt_projections%ROWTYPE;
BEGIN
    DELETE FROM analytics.placement_student_rollups
    WHERE tenant_id = p_tenant_id AND student_id = p_student_id;

    SELECT * INTO affiliation_record
    FROM analytics.student_affiliation_projections
    WHERE tenant_id = p_tenant_id AND student_id = p_student_id;
    IF NOT FOUND THEN
        RETURN;
    END IF;
    SELECT * INTO latest_attempt
    FROM analytics.attempt_projections
    WHERE tenant_id = p_tenant_id AND candidate_id = p_student_id
    ORDER BY completed_at DESC, attempt_id DESC
    LIMIT 1;
    IF NOT FOUND THEN
        RETURN;
    END IF;
    INSERT INTO analytics.placement_student_rollups (
        tenant_id, placement_department_id, student_id, home_department_id,
        latest_exam_version_id, latest_score, latest_activity_at, source_revision, computed_at, version
    ) VALUES (
        p_tenant_id, affiliation_record.placement_department_id, p_student_id,
        affiliation_record.college_department_id, latest_attempt.exam_version_id,
        latest_attempt.score, latest_attempt.completed_at, latest_attempt.attempt_number,
        clock_timestamp(), 1
    ) ON CONFLICT (tenant_id, placement_department_id, student_id) DO UPDATE
    SET home_department_id = EXCLUDED.home_department_id,
        latest_exam_version_id = EXCLUDED.latest_exam_version_id,
        latest_score = EXCLUDED.latest_score,
        latest_activity_at = EXCLUDED.latest_activity_at,
        source_revision = EXCLUDED.source_revision,
        computed_at = clock_timestamp(),
        version = analytics.placement_student_rollups.version + 1;
END
$function$;

CREATE FUNCTION analytics.rebuild_attempt_rollups(p_tenant_id uuid, p_attempt_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, analytics AS $function$
DECLARE attempt_record analytics.attempt_projections%ROWTYPE;
BEGIN
    SELECT * INTO attempt_record
    FROM analytics.attempt_projections
    WHERE tenant_id = p_tenant_id AND attempt_id = p_attempt_id;
    IF NOT FOUND THEN
        RETURN;
    END IF;

    INSERT INTO analytics.exam_result_rollups (
        tenant_id, exam_id, exam_version_id, candidate_id, attempt_id,
        lifecycle_state, score, maximum_score, submitted_at, graded_at,
        candidate_assignment_id, attempt_number, source_revision, computed_at, version
    ) VALUES (
        attempt_record.tenant_id, attempt_record.exam_id, attempt_record.exam_version_id,
        attempt_record.candidate_id, attempt_record.attempt_id, 'graded', attempt_record.score,
        attempt_record.maximum_score, attempt_record.completed_at, attempt_record.completed_at,
        attempt_record.candidate_assignment_id, attempt_record.attempt_number,
        attempt_record.attempt_number, clock_timestamp(), 1
    ) ON CONFLICT (tenant_id, attempt_id) DO UPDATE
    SET lifecycle_state = EXCLUDED.lifecycle_state,
        score = EXCLUDED.score,
        maximum_score = EXCLUDED.maximum_score,
        submitted_at = EXCLUDED.submitted_at,
        graded_at = EXCLUDED.graded_at,
        candidate_assignment_id = EXCLUDED.candidate_assignment_id,
        attempt_number = EXCLUDED.attempt_number,
        source_revision = EXCLUDED.source_revision,
        computed_at = clock_timestamp(),
        version = analytics.exam_result_rollups.version + 1;

    DELETE FROM analytics.attempt_question_results
    WHERE tenant_id = p_tenant_id AND attempt_id = p_attempt_id;
    INSERT INTO analytics.attempt_question_results (
        tenant_id, attempt_id, student_id, question_id, awarded_score,
        maximum_score, accepted, completed_at
    )
    SELECT attempt_record.tenant_id, attempt_record.attempt_id,
           attempt_record.candidate_id, item.question_id,
           sum(CASE WHEN evaluation.verdict = 'accepted' THEN evaluation.maximum_score ELSE 0 END),
           sum(evaluation.maximum_score), bool_and(evaluation.verdict = 'accepted'),
           attempt_record.completed_at
    FROM analytics.evaluation_projections AS evaluation
    JOIN analytics.exam_item_projections AS item
      ON item.tenant_id = evaluation.tenant_id
     AND item.exam_item_id = evaluation.exam_item_id
    WHERE evaluation.tenant_id = p_tenant_id
      AND evaluation.attempt_id = p_attempt_id
      AND evaluation.verdict IS NOT NULL
    GROUP BY item.question_id;

    DELETE FROM analytics.student_progress_rollups
    WHERE tenant_id = p_tenant_id AND student_id = attempt_record.candidate_id;
    INSERT INTO analytics.student_progress_rollups (
        tenant_id, student_id, question_id, attempts_count, accepted_count,
        best_score, last_attempt_at, source_revision, computed_at, version
    )
    SELECT result.tenant_id, result.student_id, result.question_id,
           count(*)::integer,
           count(*) FILTER (WHERE result.accepted)::integer,
           max(result.awarded_score), max(result.completed_at),
           max(attempt.attempt_number), clock_timestamp(), 1
    FROM analytics.attempt_question_results AS result
    JOIN analytics.attempt_projections AS attempt
      ON attempt.tenant_id = result.tenant_id
     AND attempt.attempt_id = result.attempt_id
    WHERE result.tenant_id = p_tenant_id
      AND result.student_id = attempt_record.candidate_id
    GROUP BY result.tenant_id, result.student_id, result.question_id;

    PERFORM analytics.rebuild_student_placement(p_tenant_id, attempt_record.candidate_id);
END
$function$;

CREATE FUNCTION analytics.apply_legal_hold(
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

CREATE FUNCTION analytics.request_report_export(
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

CREATE FUNCTION analytics.purge_expired_retained_data(p_limit integer DEFAULT 1000)
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

DO $projection_tables$
DECLARE table_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'analytics.student_affiliation_projections',
        'analytics.exam_item_projections',
        'analytics.candidate_assignment_projections',
        'analytics.evaluation_projections',
        'analytics.judge_completion_projections',
        'analytics.attempt_projections',
        'analytics.attempt_question_results',
        'analytics.legal_hold_projections',
        'analytics.retention_policy_revisions'
    ] LOOP
        EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', table_name);
        EXECUTE format('CREATE POLICY %I ON %s FOR ALL TO aether_analytics_projection_worker USING (true) WITH CHECK (true)', replace(table_name, '.', '_') || '_projection_worker', table_name);
        EXECUTE format('CREATE POLICY %I ON %s FOR ALL TO aether_analytics_owner USING (true) WITH CHECK (true)', replace(table_name, '.', '_') || '_owner_maintenance', table_name);
    END LOOP;
END
$projection_tables$;

CREATE POLICY analytics_event_facts_projection_worker ON analytics.event_facts
    FOR INSERT TO aether_analytics_projection_worker WITH CHECK (true);

GRANT USAGE ON SCHEMA app, analytics TO aether_analytics_projection_worker;
GRANT SELECT, INSERT, UPDATE ON TABLE app.inbox_messages
TO aether_analytics_projection_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
    analytics.student_affiliation_projections,
    analytics.exam_item_projections,
    analytics.candidate_assignment_projections,
    analytics.evaluation_projections,
    analytics.judge_completion_projections,
    analytics.attempt_projections,
    analytics.attempt_question_results,
    analytics.legal_hold_projections,
    analytics.retention_policy_revisions,
    analytics.event_facts
TO aether_analytics_projection_worker;
GRANT EXECUTE ON FUNCTION app.ensure_analytics_event_fact_partitions(timestamptz),
    analytics.rebuild_student_placement(uuid, uuid),
    analytics.rebuild_attempt_rollups(uuid, uuid),
    analytics.apply_legal_hold(uuid, uuid, text, uuid, boolean, uuid)
TO aether_analytics_projection_worker;

-- HTTP request connections receive only read access. Export creation is a
-- narrow owner-owned function that binds requested_by to the signed context.
REVOKE INSERT, UPDATE, DELETE ON TABLE
    analytics.student_progress_rollups,
    analytics.exam_result_rollups,
    analytics.batch_progress_rollups,
    analytics.placement_student_rollups,
    analytics.report_exports,
    analytics.event_facts
FROM aether_analytics_app;
GRANT EXECUTE ON FUNCTION analytics.request_report_export(uuid, uuid, text, jsonb, uuid)
    TO aether_analytics_app;
REVOKE ALL ON FUNCTION authz.current_context_actor_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION analytics.request_report_export(uuid, uuid, text, jsonb, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION analytics.purge_expired_retained_data(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION analytics.purge_expired_retained_data(integer)
    TO aether_analytics_migrator;

RESET ROLE;
