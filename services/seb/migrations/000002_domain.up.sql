SET ROLE aether_seb_owner;

CREATE TABLE seb.configurations (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    exam_id uuid NOT NULL,
    exam_version_id uuid NOT NULL,
    configuration_version integer NOT NULL CHECK (configuration_version > 0),
    config_object_key text NOT NULL CHECK (length(config_object_key) > 0),
    config_checksum char(64) NOT NULL CHECK (config_checksum ~* '^[0-9a-f]{64}$'),
    encryption_key_reference text NOT NULL CHECK (length(encryption_key_reference) > 0),
    config_key_hash char(64) NOT NULL CHECK (config_key_hash ~* '^[0-9a-f]{64}$'),
    browser_exam_key_hash char(64) CHECK (browser_exam_key_hash IS NULL OR browser_exam_key_hash ~* '^[0-9a-f]{64}$'),
    lifecycle_state text NOT NULL DEFAULT 'active' CHECK (lifecycle_state IN ('active', 'retired', 'revoked')),
    created_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    retired_at timestamptz,
    revoked_at timestamptz,
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, exam_version_id, configuration_version),
    CHECK (
        (lifecycle_state = 'active' AND retired_at IS NULL AND revoked_at IS NULL)
        OR (lifecycle_state = 'retired' AND retired_at IS NOT NULL AND revoked_at IS NULL)
        OR (lifecycle_state = 'revoked' AND revoked_at IS NOT NULL)
    )
);
CREATE UNIQUE INDEX configurations_one_active_exam_version_idx
    ON seb.configurations (tenant_id, exam_version_id) WHERE lifecycle_state = 'active';

CREATE TABLE seb.key_rotations (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    previous_configuration_id uuid NOT NULL,
    replacement_configuration_id uuid NOT NULL,
    reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
    rotated_by uuid NOT NULL,
    rotated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, previous_configuration_id),
    FOREIGN KEY (tenant_id, previous_configuration_id)
        REFERENCES seb.configurations (tenant_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, replacement_configuration_id)
        REFERENCES seb.configurations (tenant_id, id) ON DELETE RESTRICT,
    CHECK (previous_configuration_id <> replacement_configuration_id)
);

CREATE TABLE seb.sessions (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    configuration_id uuid NOT NULL,
    attempt_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    quit_token_hash char(64) NOT NULL CHECK (quit_token_hash ~* '^[0-9a-f]{64}$'),
    lifecycle_state text NOT NULL DEFAULT 'issued'
        CHECK (lifecycle_state IN ('issued', 'active', 'closed', 'revoked', 'expired')),
    issued_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    activated_at timestamptz,
    closed_at timestamptz,
    expires_at timestamptz NOT NULL,
    closed_reason text,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, attempt_id),
    FOREIGN KEY (tenant_id, configuration_id)
        REFERENCES seb.configurations (tenant_id, id) ON DELETE RESTRICT,
    CHECK (expires_at > issued_at),
    CHECK (lifecycle_state <> 'active' OR activated_at IS NOT NULL),
    CHECK (lifecycle_state NOT IN ('closed', 'revoked', 'expired') OR closed_at IS NOT NULL)
);
CREATE INDEX sessions_configuration_idx ON seb.sessions (tenant_id, configuration_id, lifecycle_state);
CREATE INDEX sessions_expiry_idx ON seb.sessions (expires_at) WHERE lifecycle_state IN ('issued', 'active');

CREATE TABLE seb.validation_events (
    id uuid NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    tenant_id uuid NOT NULL,
    configuration_id uuid NOT NULL,
    session_id uuid,
    attempt_id uuid NOT NULL,
    header_kind text NOT NULL CHECK (header_kind IN ('config_key', 'browser_exam_key')),
    header_present boolean NOT NULL,
    validation_result text NOT NULL CHECK (validation_result IN ('matched', 'missing', 'mismatched', 'expired_session', 'closed_session', 'revoked_configuration')),
    request_fingerprint_hash char(64) CHECK (request_fingerprint_hash IS NULL OR request_fingerprint_hash ~* '^[0-9a-f]{64}$'),
    retention_until timestamptz NOT NULL DEFAULT (CURRENT_TIMESTAMP + interval '7 years'),
    legal_hold boolean NOT NULL DEFAULT false,
    PRIMARY KEY (id, occurred_at),
    CHECK (retention_until >= occurred_at),
    CHECK (
        (validation_result = 'matched' AND header_present)
        OR validation_result <> 'matched'
    )
) PARTITION BY RANGE (occurred_at);

CREATE FUNCTION app.ensure_seb_validation_event_partitions(
    partition_through timestamptz DEFAULT (CURRENT_TIMESTAMP + interval '2 months')
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, app, seb AS $$
DECLARE
    partition_start timestamptz := date_trunc('month', CURRENT_TIMESTAMP);
    partition_limit timestamptz := date_trunc('month', partition_through);
    partition_end timestamptz;
    partition_name text;
BEGIN
    WHILE partition_start <= partition_limit LOOP
        partition_end := partition_start + interval '1 month';
        partition_name := format('validation_events_%s', to_char(partition_start, 'YYYYMM'));
        EXECUTE format('CREATE TABLE IF NOT EXISTS seb.%I PARTITION OF seb.validation_events FOR VALUES FROM (%L) TO (%L)', partition_name, partition_start, partition_end);
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON seb.%I (tenant_id, attempt_id, occurred_at DESC)', format('%s_tenant_attempt_idx', partition_name), partition_name);
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON seb.%I (retention_until) WHERE NOT legal_hold', format('%s_retention_idx', partition_name), partition_name);
        partition_start := partition_end;
    END LOOP;
END;
$$;
SELECT app.ensure_seb_validation_event_partitions();
REVOKE ALL ON FUNCTION app.ensure_seb_validation_event_partitions(timestamptz) FROM PUBLIC;

CREATE FUNCTION seb.reject_configuration_material_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.exam_id IS DISTINCT FROM OLD.exam_id
       OR NEW.exam_version_id IS DISTINCT FROM OLD.exam_version_id
       OR NEW.configuration_version IS DISTINCT FROM OLD.configuration_version
       OR NEW.config_object_key IS DISTINCT FROM OLD.config_object_key
       OR NEW.config_checksum IS DISTINCT FROM OLD.config_checksum
       OR NEW.encryption_key_reference IS DISTINCT FROM OLD.encryption_key_reference
       OR NEW.config_key_hash IS DISTINCT FROM OLD.config_key_hash
       OR NEW.browser_exam_key_hash IS DISTINCT FROM OLD.browser_exam_key_hash THEN
        RAISE EXCEPTION 'SEB configuration material is immutable; rotate to a new configuration' USING ERRCODE = '55000';
    END IF;
    IF OLD.lifecycle_state IN ('retired', 'revoked') THEN
        RAISE EXCEPTION 'retired or revoked SEB configuration % cannot change', OLD.id USING ERRCODE = '55000';
    END IF;
    IF OLD.lifecycle_state = 'active' AND NEW.lifecycle_state NOT IN ('retired', 'revoked') THEN
        RAISE EXCEPTION 'active SEB configuration % may only be retired or revoked', OLD.id USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION seb.reject_append_only_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
    RAISE EXCEPTION '% records are append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER configurations_material_immutable
    BEFORE UPDATE ON seb.configurations FOR EACH ROW EXECUTE FUNCTION seb.reject_configuration_material_mutation();
CREATE TRIGGER key_rotations_append_only
    BEFORE UPDATE OR DELETE ON seb.key_rotations FOR EACH ROW EXECUTE FUNCTION seb.reject_append_only_mutation();
CREATE TRIGGER validation_events_append_only
    BEFORE UPDATE OR DELETE ON seb.validation_events FOR EACH ROW EXECUTE FUNCTION seb.reject_append_only_mutation();

ALTER TABLE seb.configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE seb.configurations FORCE ROW LEVEL SECURITY;
ALTER TABLE seb.key_rotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE seb.key_rotations FORCE ROW LEVEL SECURITY;
ALTER TABLE seb.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE seb.sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE seb.validation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE seb.validation_events FORCE ROW LEVEL SECURITY;

DO $policies$
DECLARE
    protected_table text;
    policy_prefix text;
BEGIN
    FOREACH protected_table IN ARRAY ARRAY[
        'seb.configurations',
        'seb.key_rotations',
        'seb.sessions',
        'seb.validation_events'
    ]
    LOOP
        policy_prefix := replace(protected_table, '.', '_');
        EXECUTE format(
            'CREATE POLICY %I ON %s FOR SELECT TO aether_seb_app USING (authz.current_context_allows_read(tenant_id, %L, %L, %L))',
            policy_prefix || '_signed_read', protected_table,
            'seb.read', 'seb.write', protected_table
        );
        EXECUTE format(
            'CREATE POLICY %I ON %s FOR INSERT TO aether_seb_app WITH CHECK (authz.current_context_allows(tenant_id, %L, %L))',
            policy_prefix || '_signed_insert', protected_table,
            'seb.write', protected_table
        );
        EXECUTE format(
            'CREATE POLICY %I ON %s FOR UPDATE TO aether_seb_app USING (authz.current_context_allows(tenant_id, %L, %L)) WITH CHECK (authz.current_context_allows(tenant_id, %L, %L))',
            policy_prefix || '_signed_update', protected_table,
            'seb.write', protected_table, 'seb.write', protected_table
        );
        EXECUTE format(
            'CREATE POLICY %I ON %s FOR DELETE TO aether_seb_app USING (authz.current_context_allows(tenant_id, %L, %L))',
            policy_prefix || '_signed_delete', protected_table,
            'seb.write', protected_table
        );
        EXECUTE format(
            'CREATE POLICY %I ON %s FOR ALL TO aether_seb_owner USING (true) WITH CHECK (true)',
            policy_prefix || '_owner_maintenance', protected_table
        );
    END LOOP;
END
$policies$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE seb.configurations, seb.sessions TO aether_seb_app;
GRANT SELECT, INSERT ON TABLE seb.key_rotations, seb.validation_events TO aether_seb_app;

RESET ROLE;
