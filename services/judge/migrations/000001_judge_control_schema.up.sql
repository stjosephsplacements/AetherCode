-- The migration connection must be a member of aether_judge_migrator. Runtime
-- principals receive only the aether_judge_app group role from the bootstrap.
SET ROLE aether_judge_migrator;

CREATE SCHEMA IF NOT EXISTS judge AUTHORIZATION aether_judge_migrator;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA judge FROM PUBLIC;
GRANT USAGE ON SCHEMA judge TO aether_judge_app;

ALTER DEFAULT PRIVILEGES FOR ROLE aether_judge_migrator IN SCHEMA judge
    REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE aether_judge_migrator IN SCHEMA judge
    REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE aether_judge_migrator IN SCHEMA judge
    REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE TABLE judge.execution_jobs (
    id uuid PRIMARY KEY,
    idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 255),
    request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
    tenant_fairness_key text NOT NULL CHECK (length(tenant_fairness_key) BETWEEN 1 AND 255),
    submission_correlation_id uuid NOT NULL,
    evaluation_bundle_ref text NOT NULL CHECK (length(evaluation_bundle_ref) BETWEEN 1 AND 2048),
    evaluation_bundle_sha256 text NOT NULL CHECK (evaluation_bundle_sha256 ~ '^[0-9a-f]{64}$'),
    source_ciphertext_ref text NOT NULL CHECK (length(source_ciphertext_ref) BETWEEN 1 AND 2048),
    source_ciphertext_sha256 text NOT NULL CHECK (source_ciphertext_sha256 ~ '^[0-9a-f]{64}$'),
    request_ciphertext_ref text NOT NULL CHECK (length(request_ciphertext_ref) BETWEEN 1 AND 2048),
    language_key text NOT NULL CHECK (language_key ~ '^[a-z0-9][a-z0-9._-]{0,127}$'),
    cpu_time_limit_ms integer NOT NULL CHECK (cpu_time_limit_ms BETWEEN 1 AND 60000),
    wall_time_limit_ms integer NOT NULL CHECK (wall_time_limit_ms BETWEEN 1 AND 120000),
    memory_limit_bytes bigint NOT NULL CHECK (memory_limit_bytes BETWEEN 1048576 AND 2147483648),
    process_limit integer NOT NULL CHECK (process_limit BETWEEN 1 AND 256),
    state text NOT NULL DEFAULT 'accepted' CHECK (state IN ('accepted', 'queued', 'dispatching', 'running', 'completed', 'failed', 'cancelled', 'expired')),
    engine_name text NOT NULL DEFAULT 'judge0' CHECK (engine_name = 'judge0'),
    engine_version text,
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    queued_at timestamptz,
    terminal_at timestamptz,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT execution_jobs_terminal_state_check CHECK (
        (state IN ('completed', 'failed', 'cancelled', 'expired')) = (terminal_at IS NOT NULL)
    ),
    CONSTRAINT execution_jobs_expiry_check CHECK (expires_at > accepted_at)
);

CREATE UNIQUE INDEX execution_jobs_idempotency_key_uq
    ON judge.execution_jobs (idempotency_key);
CREATE INDEX execution_jobs_dispatch_idx
    ON judge.execution_jobs (state, queued_at, accepted_at)
    WHERE state IN ('accepted', 'queued', 'dispatching');
CREATE INDEX execution_jobs_retention_idx
    ON judge.execution_jobs (expires_at)
    WHERE terminal_at IS NOT NULL;
CREATE INDEX execution_jobs_correlation_idx
    ON judge.execution_jobs (submission_correlation_id);

CREATE TABLE judge.execution_units (
    id uuid PRIMARY KEY,
    job_id uuid NOT NULL REFERENCES judge.execution_jobs (id) ON DELETE CASCADE,
    unit_number integer NOT NULL CHECK (unit_number >= 0),
    test_case_ciphertext_ref text NOT NULL CHECK (length(test_case_ciphertext_ref) BETWEEN 1 AND 2048),
    state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'dispatching', 'submitted', 'running', 'completed', 'failed', 'cancelled', 'expired')),
    judge0_token text CHECK (judge0_token IS NULL OR length(judge0_token) BETWEEN 1 AND 1024),
    normalized_verdict text CHECK (normalized_verdict IN ('accepted', 'wrong_answer', 'time_limit_exceeded', 'memory_limit_exceeded', 'runtime_error', 'compilation_error', 'internal_error', 'cancelled')),
    raw_result_ciphertext_ref text CHECK (raw_result_ciphertext_ref IS NULL OR length(raw_result_ciphertext_ref) BETWEEN 1 AND 2048),
    raw_result_sha256 text CHECK (raw_result_sha256 IS NULL OR raw_result_sha256 ~ '^[0-9a-f]{64}$'),
    cpu_time_ms integer CHECK (cpu_time_ms IS NULL OR cpu_time_ms >= 0),
    wall_time_ms integer CHECK (wall_time_ms IS NULL OR wall_time_ms >= 0),
    memory_bytes bigint CHECK (memory_bytes IS NULL OR memory_bytes >= 0),
    exit_code integer,
    exit_signal integer,
    terminal_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT execution_units_terminal_state_check CHECK (
        (state IN ('completed', 'failed', 'cancelled', 'expired')) = (terminal_at IS NOT NULL)
    ),
    CONSTRAINT execution_units_result_check CHECK (
        (state = 'completed') = (normalized_verdict IS NOT NULL)
    ),
    CONSTRAINT execution_units_result_reference_check CHECK (
        raw_result_sha256 IS NULL OR raw_result_ciphertext_ref IS NOT NULL
    ),
    CONSTRAINT execution_units_job_number_uq UNIQUE (job_id, unit_number)
);

CREATE UNIQUE INDEX execution_units_judge0_token_uq
    ON judge.execution_units (judge0_token)
    WHERE judge0_token IS NOT NULL;
CREATE INDEX execution_units_dispatch_idx
    ON judge.execution_units (state, created_at)
    WHERE state IN ('queued', 'dispatching');
CREATE INDEX execution_units_job_idx ON judge.execution_units (job_id, unit_number);

CREATE TABLE judge.dispatch_attempts (
    id uuid PRIMARY KEY,
    execution_unit_id uuid NOT NULL REFERENCES judge.execution_units (id) ON DELETE CASCADE,
    attempt_number integer NOT NULL CHECK (attempt_number > 0),
    state text NOT NULL CHECK (state IN ('scheduled', 'submitted', 'polling', 'succeeded', 'failed', 'abandoned')),
    worker_id text NOT NULL CHECK (length(worker_id) BETWEEN 1 AND 255),
    engine_request_id text CHECK (engine_request_id IS NULL OR length(engine_request_id) BETWEEN 1 AND 1024),
    failure_class text CHECK (failure_class IN ('transient', 'permanent', 'timeout', 'engine_unavailable', 'engine_protocol')),
    failure_detail text CHECK (failure_detail IS NULL OR length(failure_detail) <= 4096),
    started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    finished_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT dispatch_attempts_finish_check CHECK (
        (state IN ('succeeded', 'failed', 'abandoned')) = (finished_at IS NOT NULL)
    ),
    CONSTRAINT dispatch_attempts_unit_attempt_uq UNIQUE (execution_unit_id, attempt_number)
);

CREATE INDEX dispatch_attempts_reconciliation_idx
    ON judge.dispatch_attempts (state, started_at)
    WHERE state IN ('submitted', 'polling');

CREATE TABLE judge.language_mappings (
    language_key text PRIMARY KEY CHECK (language_key ~ '^[a-z0-9][a-z0-9._-]{0,127}$'),
    engine_name text NOT NULL DEFAULT 'judge0' CHECK (engine_name = 'judge0'),
    engine_language_id integer NOT NULL CHECK (engine_language_id > 0),
    engine_version text NOT NULL CHECK (length(engine_version) BETWEEN 1 AND 128),
    enabled boolean NOT NULL DEFAULT true,
    max_parallelism integer NOT NULL CHECK (max_parallelism > 0),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT language_mappings_engine_language_uq UNIQUE (engine_name, engine_version, engine_language_id)
);

CREATE TABLE judge.execution_events (
    occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    event_id uuid NOT NULL,
    job_id uuid NOT NULL,
    execution_unit_id uuid,
    event_type text NOT NULL CHECK (event_type ~ '^execution\\.[a-z_]+\\.v1$'),
    payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
        jsonb_typeof(payload) = 'object' AND pg_column_size(payload) <= 65536
    ),
    PRIMARY KEY (occurred_at, event_id)
) PARTITION BY RANGE (occurred_at);

CREATE INDEX execution_events_job_idx
    ON judge.execution_events (job_id, occurred_at DESC);

-- RabbitMQ is only a durable wake-up/claim transport. The notification that
-- leaves this table contains event_id and job_id, never source, tests, or an
-- execution payload. Workers reload all execution material from the wrapper
-- control database and encrypted object storage after claiming the job.
CREATE TABLE judge.admission_outbox (
    event_id uuid PRIMARY KEY,
    job_id uuid NOT NULL UNIQUE REFERENCES judge.execution_jobs (id) ON DELETE CASCADE,
    state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'leased', 'published', 'consumed', 'expired')),
    available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    lease_owner text,
    lease_id uuid UNIQUE,
    lease_expires_at timestamptz,
    publish_attempt_count integer NOT NULL DEFAULT 0 CHECK (publish_attempt_count >= 0),
    last_publish_error text CHECK (last_publish_error IS NULL OR length(last_publish_error) <= 4096),
    published_at timestamptz,
    consumed_at timestamptz,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT admission_outbox_lease_check CHECK (
        (state = 'leased' AND lease_owner IS NOT NULL AND lease_id IS NOT NULL AND lease_expires_at IS NOT NULL)
        OR
        (state <> 'leased' AND lease_owner IS NULL AND lease_id IS NULL AND lease_expires_at IS NULL)
    ),
    CONSTRAINT admission_outbox_consumed_check CHECK (
        consumed_at IS NULL OR published_at IS NOT NULL
    ),
    CONSTRAINT admission_outbox_expiry_check CHECK (expires_at > created_at)
);

CREATE INDEX admission_outbox_publish_idx
    ON judge.admission_outbox (available_at, created_at)
    WHERE state IN ('pending', 'leased');
CREATE INDEX admission_outbox_reconciliation_idx
    ON judge.admission_outbox (published_at)
    WHERE state = 'published';

CREATE TABLE judge.outbox_events (
    event_id uuid PRIMARY KEY,
    aggregate_id uuid NOT NULL,
    event_type text NOT NULL CHECK (event_type IN ('judge.completed.v1', 'judge.failed.v1')),
    payload jsonb NOT NULL CHECK (
        jsonb_typeof(payload) = 'object' AND pg_column_size(payload) <= 65536
    ),
    payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
    state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'leased', 'acknowledged', 'expired')),
    available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    lease_owner text,
    lease_id uuid UNIQUE,
    lease_expires_at timestamptz,
    acknowledged_at timestamptz,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT outbox_events_lease_check CHECK (
        (state = 'leased' AND lease_owner IS NOT NULL AND lease_id IS NOT NULL AND lease_expires_at IS NOT NULL)
        OR
        (state <> 'leased' AND lease_owner IS NULL AND lease_id IS NULL AND lease_expires_at IS NULL)
    ),
    CONSTRAINT outbox_events_ack_check CHECK (
        (state = 'acknowledged') = (acknowledged_at IS NOT NULL)
    ),
    CONSTRAINT outbox_events_expiry_check CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX outbox_events_terminal_job_uq
    ON judge.outbox_events (aggregate_id)
    WHERE event_type IN ('judge.completed.v1', 'judge.failed.v1');
CREATE INDEX outbox_events_pull_idx
    ON judge.outbox_events (available_at, created_at)
    WHERE state IN ('pending', 'leased');

CREATE TABLE judge.completion_deliveries (
    leased_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    delivery_id uuid NOT NULL,
    consumer_id text NOT NULL CHECK (length(consumer_id) BETWEEN 1 AND 255),
    event_id uuid NOT NULL REFERENCES judge.outbox_events (event_id) ON DELETE CASCADE,
    lease_id uuid NOT NULL,
    lease_expires_at timestamptz NOT NULL,
    acknowledged_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (leased_at, delivery_id),
    CONSTRAINT completion_deliveries_lease_uq UNIQUE (leased_at, lease_id),
    CONSTRAINT completion_deliveries_lease_expiry_check CHECK (lease_expires_at > leased_at),
    CONSTRAINT completion_deliveries_ack_time_check CHECK (
        acknowledged_at IS NULL OR acknowledged_at >= leased_at
    )
) PARTITION BY RANGE (leased_at);

CREATE INDEX completion_deliveries_event_consumer_idx
    ON judge.completion_deliveries (event_id, consumer_id, leased_at DESC);
CREATE INDEX completion_deliveries_unacknowledged_lease_idx
    ON judge.completion_deliveries (consumer_id, lease_expires_at)
    WHERE acknowledged_at IS NULL;

CREATE TABLE judge.inbox_messages (
    source_name text NOT NULL CHECK (length(source_name) BETWEEN 1 AND 255),
    message_id uuid NOT NULL,
    received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    processed_at timestamptz,
    payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
    PRIMARY KEY (source_name, message_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA judge TO aether_judge_app;
ALTER DEFAULT PRIVILEGES FOR ROLE aether_judge_migrator IN SCHEMA judge
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO aether_judge_app;
