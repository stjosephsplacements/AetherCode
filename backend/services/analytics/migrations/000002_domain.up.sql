SET ROLE aether_analytics_owner;

CREATE TABLE analytics.student_progress_rollups (
    tenant_id uuid NOT NULL,
    student_id uuid NOT NULL,
    question_id uuid NOT NULL,
    attempts_count integer NOT NULL DEFAULT 0 CHECK (attempts_count >= 0),
    accepted_count integer NOT NULL DEFAULT 0 CHECK (accepted_count >= 0),
    best_score numeric(12,4) NOT NULL DEFAULT 0 CHECK (best_score >= 0),
    last_attempt_at timestamptz,
    source_revision bigint NOT NULL DEFAULT 0 CHECK (source_revision >= 0),
    computed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    PRIMARY KEY (tenant_id, student_id, question_id),
    CHECK (accepted_count <= attempts_count)
);
CREATE INDEX student_progress_student_idx
    ON analytics.student_progress_rollups (tenant_id, student_id, last_attempt_at DESC NULLS LAST);

CREATE TABLE analytics.exam_result_rollups (
    tenant_id uuid NOT NULL,
    exam_id uuid NOT NULL,
    exam_version_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    attempt_id uuid NOT NULL,
    lifecycle_state text NOT NULL CHECK (lifecycle_state IN ('assigned', 'in_progress', 'graded', 'invalidated')),
    score numeric(12,4),
    maximum_score numeric(12,4),
    submitted_at timestamptz,
    graded_at timestamptz,
    source_revision bigint NOT NULL DEFAULT 0 CHECK (source_revision >= 0),
    computed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    PRIMARY KEY (tenant_id, attempt_id),
    UNIQUE (tenant_id, exam_version_id, candidate_id),
    CHECK (
        (score IS NULL AND maximum_score IS NULL)
        OR (score IS NOT NULL AND maximum_score IS NOT NULL AND score >= 0 AND maximum_score > 0 AND score <= maximum_score)
    ),
    CHECK (lifecycle_state <> 'graded' OR graded_at IS NOT NULL)
);
CREATE INDEX exam_result_exam_idx
    ON analytics.exam_result_rollups (tenant_id, exam_version_id, lifecycle_state, graded_at DESC NULLS LAST);

CREATE TABLE analytics.batch_progress_rollups (
    tenant_id uuid NOT NULL,
    batch_id uuid NOT NULL,
    exam_version_id uuid NOT NULL,
    assigned_count integer NOT NULL DEFAULT 0 CHECK (assigned_count >= 0),
    started_count integer NOT NULL DEFAULT 0 CHECK (started_count >= 0),
    completed_count integer NOT NULL DEFAULT 0 CHECK (completed_count >= 0),
    average_score numeric(12,4),
    source_revision bigint NOT NULL DEFAULT 0 CHECK (source_revision >= 0),
    computed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    PRIMARY KEY (tenant_id, batch_id, exam_version_id),
    CHECK (started_count <= assigned_count),
    CHECK (completed_count <= started_count),
    CHECK (average_score IS NULL OR average_score >= 0)
);

CREATE TABLE analytics.placement_student_rollups (
    tenant_id uuid NOT NULL,
    placement_department_id uuid NOT NULL,
    student_id uuid NOT NULL,
    home_department_id uuid NOT NULL,
    latest_exam_version_id uuid,
    latest_score numeric(12,4),
    latest_activity_at timestamptz,
    source_revision bigint NOT NULL DEFAULT 0 CHECK (source_revision >= 0),
    computed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    PRIMARY KEY (tenant_id, placement_department_id, student_id),
    CHECK (latest_score IS NULL OR latest_score >= 0)
);
CREATE INDEX placement_student_department_idx
    ON analytics.placement_student_rollups (tenant_id, placement_department_id, latest_activity_at DESC NULLS LAST);

CREATE TABLE analytics.report_exports (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    requested_by uuid NOT NULL,
    report_type text NOT NULL CHECK (report_type IN ('student_progress', 'exam_results', 'batch_progress', 'placement_progress')),
    filters jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(filters) = 'object'),
    lifecycle_state text NOT NULL CHECK (lifecycle_state IN ('queued', 'running', 'completed', 'failed', 'expired')),
    object_key text,
    checksum char(64) CHECK (checksum IS NULL OR checksum ~* '^[0-9a-f]{64}$'),
    encryption_key_reference text,
    requested_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at timestamptz,
    expires_at timestamptz NOT NULL DEFAULT (CURRENT_TIMESTAMP + interval '30 days'),
    retention_until timestamptz NOT NULL DEFAULT (CURRENT_TIMESTAMP + interval '7 years'),
    legal_hold boolean NOT NULL DEFAULT false,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    UNIQUE (tenant_id, id),
    CHECK (
        (object_key IS NULL AND checksum IS NULL AND encryption_key_reference IS NULL)
        OR (object_key IS NOT NULL AND checksum IS NOT NULL AND encryption_key_reference IS NOT NULL)
    ),
    CHECK (expires_at >= requested_at),
    CHECK (retention_until >= requested_at),
    CHECK (lifecycle_state <> 'completed' OR completed_at IS NOT NULL)
);
CREATE INDEX report_exports_request_idx
    ON analytics.report_exports (tenant_id, requested_by, requested_at DESC);
CREATE INDEX report_exports_expiry_idx
    ON analytics.report_exports (expires_at) WHERE lifecycle_state = 'completed';

CREATE TABLE analytics.event_facts (
    id uuid NOT NULL,
    occurred_at timestamptz NOT NULL,
    tenant_id uuid NOT NULL,
    source_event_id uuid NOT NULL,
    source_service text NOT NULL CHECK (length(source_service) BETWEEN 1 AND 80),
    event_type text NOT NULL CHECK (length(event_type) BETWEEN 1 AND 180),
    subject_id uuid,
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    retention_until timestamptz NOT NULL DEFAULT (CURRENT_TIMESTAMP + interval '7 years'),
    legal_hold boolean NOT NULL DEFAULT false,
    PRIMARY KEY (id, occurred_at),
    UNIQUE (source_event_id, occurred_at),
    CHECK (retention_until >= occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE FUNCTION app.ensure_analytics_event_fact_partitions(
    partition_through timestamptz DEFAULT (CURRENT_TIMESTAMP + interval '2 months')
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, app, analytics AS $$
DECLARE
    partition_start timestamptz := date_trunc('month', CURRENT_TIMESTAMP);
    partition_limit timestamptz := date_trunc('month', partition_through);
    partition_end timestamptz;
    partition_name text;
BEGIN
    WHILE partition_start <= partition_limit LOOP
        partition_end := partition_start + interval '1 month';
        partition_name := format('event_facts_%s', to_char(partition_start, 'YYYYMM'));
        EXECUTE format('CREATE TABLE IF NOT EXISTS analytics.%I PARTITION OF analytics.event_facts FOR VALUES FROM (%L) TO (%L)', partition_name, partition_start, partition_end);
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON analytics.%I (tenant_id, event_type, occurred_at DESC)', format('%s_tenant_event_idx', partition_name), partition_name);
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON analytics.%I (retention_until) WHERE NOT legal_hold', format('%s_retention_idx', partition_name), partition_name);
        partition_start := partition_end;
    END LOOP;
END;
$$;
SELECT app.ensure_analytics_event_fact_partitions();
REVOKE ALL ON FUNCTION app.ensure_analytics_event_fact_partitions(timestamptz) FROM PUBLIC;

CREATE FUNCTION analytics.reject_event_fact_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
    RAISE EXCEPTION 'analytics event facts are append-only' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER event_facts_append_only
    BEFORE UPDATE OR DELETE ON analytics.event_facts
    FOR EACH ROW EXECUTE FUNCTION analytics.reject_event_fact_mutation();

ALTER TABLE analytics.student_progress_rollups ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.student_progress_rollups FORCE ROW LEVEL SECURITY;
ALTER TABLE analytics.exam_result_rollups ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.exam_result_rollups FORCE ROW LEVEL SECURITY;
ALTER TABLE analytics.batch_progress_rollups ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.batch_progress_rollups FORCE ROW LEVEL SECURITY;
ALTER TABLE analytics.placement_student_rollups ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.placement_student_rollups FORCE ROW LEVEL SECURITY;
ALTER TABLE analytics.report_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.report_exports FORCE ROW LEVEL SECURITY;
ALTER TABLE analytics.event_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.event_facts FORCE ROW LEVEL SECURITY;

DO $policies$
DECLARE
    protected_table text;
    policy_prefix text;
BEGIN
    FOREACH protected_table IN ARRAY ARRAY[
        'analytics.student_progress_rollups',
        'analytics.exam_result_rollups',
        'analytics.batch_progress_rollups',
        'analytics.placement_student_rollups',
        'analytics.report_exports',
        'analytics.event_facts'
    ]
    LOOP
        policy_prefix := replace(protected_table, '.', '_');
        EXECUTE format(
            'CREATE POLICY %I ON %s FOR SELECT TO aether_analytics_app USING (authz.current_context_allows_read(tenant_id, %L, %L, %L))',
            policy_prefix || '_signed_read', protected_table,
            'analytics.read', 'analytics.write', protected_table
        );
        EXECUTE format(
            'CREATE POLICY %I ON %s FOR INSERT TO aether_analytics_app WITH CHECK (authz.current_context_allows(tenant_id, %L, %L))',
            policy_prefix || '_signed_insert', protected_table,
            'analytics.write', protected_table
        );
        EXECUTE format(
            'CREATE POLICY %I ON %s FOR UPDATE TO aether_analytics_app USING (authz.current_context_allows(tenant_id, %L, %L)) WITH CHECK (authz.current_context_allows(tenant_id, %L, %L))',
            policy_prefix || '_signed_update', protected_table,
            'analytics.write', protected_table, 'analytics.write', protected_table
        );
        EXECUTE format(
            'CREATE POLICY %I ON %s FOR DELETE TO aether_analytics_app USING (authz.current_context_allows(tenant_id, %L, %L))',
            policy_prefix || '_signed_delete', protected_table,
            'analytics.write', protected_table
        );
        EXECUTE format(
            'CREATE POLICY %I ON %s FOR ALL TO aether_analytics_owner USING (true) WITH CHECK (true)',
            policy_prefix || '_owner_maintenance', protected_table
        );
    END LOOP;
END
$policies$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
    analytics.student_progress_rollups,
    analytics.exam_result_rollups,
    analytics.batch_progress_rollups,
    analytics.placement_student_rollups,
    analytics.report_exports
TO aether_analytics_app;
GRANT SELECT, INSERT ON TABLE analytics.event_facts TO aether_analytics_app;

RESET ROLE;
