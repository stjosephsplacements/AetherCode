SET ROLE aether_submission_owner;

CREATE TABLE submission.attempts (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    exam_id uuid NOT NULL,
    exam_version_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    candidate_assignment_id uuid NOT NULL,
    attempt_number smallint NOT NULL CHECK (attempt_number > 0),
    lifecycle_state text NOT NULL DEFAULT 'created'
        CHECK (lifecycle_state IN ('created', 'active', 'submitted', 'grading', 'graded', 'expired', 'cancelled')),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at timestamptz,
    submitted_at timestamptz,
    completed_at timestamptz,
    submission_deadline timestamptz NOT NULL,
    retention_until timestamptz NOT NULL DEFAULT (CURRENT_TIMESTAMP + interval '7 years'),
    legal_hold boolean NOT NULL DEFAULT false,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, exam_version_id, candidate_id, attempt_number),
    CHECK (submission_deadline >= created_at),
    CHECK (started_at IS NULL OR started_at >= created_at),
    CHECK (submitted_at IS NULL OR started_at IS NULL OR submitted_at >= started_at),
    CHECK (completed_at IS NULL OR submitted_at IS NULL OR completed_at >= submitted_at),
    CHECK (retention_until >= created_at),
    CHECK (
        lifecycle_state NOT IN ('submitted', 'grading', 'graded')
        OR submitted_at IS NOT NULL
    ),
    CHECK (lifecycle_state <> 'graded' OR completed_at IS NOT NULL)
);

CREATE INDEX attempts_candidate_idx
    ON submission.attempts (tenant_id, candidate_id, created_at DESC);
CREATE INDEX attempts_exam_state_idx
    ON submission.attempts (tenant_id, exam_version_id, lifecycle_state, created_at DESC);
CREATE INDEX attempts_retention_idx
    ON submission.attempts (retention_until) WHERE NOT legal_hold;

CREATE TABLE submission.answer_revisions (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    attempt_id uuid NOT NULL,
    exam_item_id uuid NOT NULL,
    revision_number integer NOT NULL CHECK (revision_number > 0),
    language_id text NOT NULL CHECK (length(language_id) BETWEEN 1 AND 80),
    source_object_key text NOT NULL CHECK (length(source_object_key) > 0),
    source_checksum char(64) NOT NULL CHECK (source_checksum ~* '^[0-9a-f]{64}$'),
    encryption_key_reference text NOT NULL CHECK (length(encryption_key_reference) > 0),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by uuid NOT NULL,
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, id, attempt_id),
    UNIQUE (tenant_id, attempt_id, exam_item_id, revision_number),
    FOREIGN KEY (tenant_id, attempt_id)
        REFERENCES submission.attempts (tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX answer_revisions_attempt_idx
    ON submission.answer_revisions (tenant_id, attempt_id, exam_item_id, revision_number DESC);

CREATE TABLE submission.evaluation_requests (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    attempt_id uuid NOT NULL,
    answer_revision_id uuid NOT NULL,
    evaluation_bundle_object_key text NOT NULL CHECK (length(evaluation_bundle_object_key) > 0),
    evaluation_bundle_checksum char(64) NOT NULL
        CHECK (evaluation_bundle_checksum ~* '^[0-9a-f]{64}$'),
    caller_idempotency_key text NOT NULL CHECK (length(caller_idempotency_key) BETWEEN 1 AND 255),
    judge_job_id uuid,
    lifecycle_state text NOT NULL DEFAULT 'queued'
        CHECK (lifecycle_state IN ('queued', 'dispatched', 'completed', 'failed', 'cancelled')),
    queued_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    dispatched_at timestamptz,
    completed_at timestamptz,
    failure_code text,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, answer_revision_id),
    UNIQUE (tenant_id, caller_idempotency_key),
    UNIQUE (tenant_id, judge_job_id),
    FOREIGN KEY (tenant_id, answer_revision_id, attempt_id)
        REFERENCES submission.answer_revisions (tenant_id, id, attempt_id) ON DELETE RESTRICT,
    CHECK ((lifecycle_state = 'dispatched') = (dispatched_at IS NOT NULL)),
    CHECK (
        lifecycle_state NOT IN ('completed', 'failed', 'cancelled')
        OR completed_at IS NOT NULL
    )
);

CREATE INDEX evaluation_requests_pending_idx
    ON submission.evaluation_requests (tenant_id, queued_at)
    WHERE lifecycle_state IN ('queued', 'dispatched');

CREATE TABLE submission.judge_receipts (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    evaluation_request_id uuid NOT NULL,
    judge_job_id uuid NOT NULL,
    judge_event_id uuid NOT NULL,
    verdict text NOT NULL
        CHECK (verdict IN ('accepted', 'wrong_answer', 'time_limit_exceeded', 'memory_limit_exceeded', 'runtime_error', 'compile_error', 'internal_error', 'cancelled')),
    execution_time_ms integer CHECK (execution_time_ms IS NULL OR execution_time_ms >= 0),
    memory_kib integer CHECK (memory_kib IS NULL OR memory_kib >= 0),
    result_object_key text,
    result_checksum char(64) CHECK (result_checksum IS NULL OR result_checksum ~* '^[0-9a-f]{64}$'),
    encryption_key_reference text,
    received_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, judge_event_id),
    UNIQUE (tenant_id, evaluation_request_id, judge_event_id),
    FOREIGN KEY (tenant_id, evaluation_request_id)
        REFERENCES submission.evaluation_requests (tenant_id, id) ON DELETE RESTRICT,
    CHECK (
        (result_object_key IS NULL AND result_checksum IS NULL AND encryption_key_reference IS NULL)
        OR (result_object_key IS NOT NULL AND result_checksum IS NOT NULL AND encryption_key_reference IS NOT NULL)
    )
);

CREATE INDEX judge_receipts_request_idx
    ON submission.judge_receipts (tenant_id, evaluation_request_id, received_at DESC);

CREATE TABLE submission.score_summaries (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    attempt_id uuid NOT NULL,
    score numeric(12,4) NOT NULL CHECK (score >= 0),
    maximum_score numeric(12,4) NOT NULL CHECK (maximum_score > 0),
    lifecycle_state text NOT NULL CHECK (lifecycle_state IN ('provisional', 'finalized', 'invalidated')),
    calculation_version integer NOT NULL CHECK (calculation_version > 0),
    calculated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finalized_at timestamptz,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, attempt_id),
    FOREIGN KEY (tenant_id, attempt_id)
        REFERENCES submission.attempts (tenant_id, id) ON DELETE RESTRICT,
    CHECK (score <= maximum_score),
    CHECK ((lifecycle_state = 'finalized') = (finalized_at IS NOT NULL))
);

CREATE TABLE submission.attempt_events (
    id uuid NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    tenant_id uuid NOT NULL,
    attempt_id uuid NOT NULL,
    actor_id uuid,
    event_type text NOT NULL CHECK (length(event_type) BETWEEN 1 AND 180),
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    retention_until timestamptz NOT NULL DEFAULT (CURRENT_TIMESTAMP + interval '7 years'),
    legal_hold boolean NOT NULL DEFAULT false,
    PRIMARY KEY (id, occurred_at),
    CHECK (retention_until >= occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE FUNCTION app.ensure_submission_attempt_event_partitions(
    partition_through timestamptz DEFAULT (CURRENT_TIMESTAMP + interval '2 months')
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, submission
AS $$
DECLARE
    partition_start timestamptz := date_trunc('month', CURRENT_TIMESTAMP);
    partition_limit timestamptz := date_trunc('month', partition_through);
    partition_end timestamptz;
    partition_name text;
BEGIN
    WHILE partition_start <= partition_limit LOOP
        partition_end := partition_start + interval '1 month';
        partition_name := format('attempt_events_%s', to_char(partition_start, 'YYYYMM'));
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS submission.%I PARTITION OF submission.attempt_events FOR VALUES FROM (%L) TO (%L)',
            partition_name, partition_start, partition_end
        );
        EXECUTE format(
            'CREATE INDEX IF NOT EXISTS %I ON submission.%I (tenant_id, attempt_id, occurred_at DESC)',
            format('%s_tenant_attempt_idx', partition_name), partition_name
        );
        EXECUTE format(
            'CREATE INDEX IF NOT EXISTS %I ON submission.%I (retention_until) WHERE NOT legal_hold',
            format('%s_retention_idx', partition_name), partition_name
        );
        partition_start := partition_end;
    END LOOP;
END;
$$;

SELECT app.ensure_submission_attempt_event_partitions();
REVOKE ALL ON FUNCTION app.ensure_submission_attempt_event_partitions(timestamptz) FROM PUBLIC;

CREATE FUNCTION submission.reject_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    RAISE EXCEPTION '% records are append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER answer_revisions_append_only
    BEFORE UPDATE OR DELETE ON submission.answer_revisions
    FOR EACH ROW EXECUTE FUNCTION submission.reject_append_only_mutation();
CREATE TRIGGER judge_receipts_append_only
    BEFORE UPDATE OR DELETE ON submission.judge_receipts
    FOR EACH ROW EXECUTE FUNCTION submission.reject_append_only_mutation();
CREATE TRIGGER attempt_events_append_only
    BEFORE UPDATE OR DELETE ON submission.attempt_events
    FOR EACH ROW EXECUTE FUNCTION submission.reject_append_only_mutation();

ALTER TABLE submission.attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission.attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE submission.answer_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission.answer_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE submission.evaluation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission.evaluation_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE submission.judge_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission.judge_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE submission.score_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission.score_summaries FORCE ROW LEVEL SECURITY;
ALTER TABLE submission.attempt_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission.attempt_events FORCE ROW LEVEL SECURITY;

DO $policies$
DECLARE
    protected_table text;
    policy_prefix text;
BEGIN
    FOREACH protected_table IN ARRAY ARRAY[
        'submission.attempts',
        'submission.answer_revisions',
        'submission.evaluation_requests',
        'submission.judge_receipts',
        'submission.score_summaries',
        'submission.attempt_events'
    ]
    LOOP
        policy_prefix := replace(protected_table, '.', '_');
        EXECUTE format(
            'CREATE POLICY %I ON %s FOR SELECT TO aether_submission_app USING (authz.current_context_allows_read(tenant_id, %L, %L, %L))',
            policy_prefix || '_signed_read', protected_table,
            'submission.read', 'submission.write', protected_table
        );
        EXECUTE format(
            'CREATE POLICY %I ON %s FOR INSERT TO aether_submission_app WITH CHECK (authz.current_context_allows(tenant_id, %L, %L))',
            policy_prefix || '_signed_insert', protected_table,
            'submission.write', protected_table
        );
        EXECUTE format(
            'CREATE POLICY %I ON %s FOR UPDATE TO aether_submission_app USING (authz.current_context_allows(tenant_id, %L, %L)) WITH CHECK (authz.current_context_allows(tenant_id, %L, %L))',
            policy_prefix || '_signed_update', protected_table,
            'submission.write', protected_table, 'submission.write', protected_table
        );
        EXECUTE format(
            'CREATE POLICY %I ON %s FOR DELETE TO aether_submission_app USING (authz.current_context_allows(tenant_id, %L, %L))',
            policy_prefix || '_signed_delete', protected_table,
            'submission.write', protected_table
        );
        EXECUTE format(
            'CREATE POLICY %I ON %s FOR ALL TO aether_submission_owner USING (true) WITH CHECK (true)',
            policy_prefix || '_owner_maintenance', protected_table
        );
    END LOOP;
END
$policies$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
    submission.attempts,
    submission.evaluation_requests,
    submission.score_summaries
TO aether_submission_app;
GRANT SELECT, INSERT ON TABLE
    submission.answer_revisions,
    submission.judge_receipts,
    submission.attempt_events
TO aether_submission_app;

RESET ROLE;
