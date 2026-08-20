SET ROLE aether_notification_owner;

CREATE TABLE notification.recipient_preferences (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    recipient_id uuid NOT NULL,
    channel text NOT NULL CHECK (channel IN ('email', 'in_app')),
    enabled boolean NOT NULL DEFAULT true,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    UNIQUE (tenant_id, recipient_id, channel)
);

CREATE TABLE notification.notifications (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    recipient_id uuid NOT NULL,
    category text NOT NULL CHECK (category IN ('exam_reminder', 'exam_result', 'system')),
    template_code text NOT NULL CHECK (length(template_code) BETWEEN 1 AND 160),
    content_object_key text NOT NULL CHECK (length(content_object_key) > 0),
    content_checksum char(64) NOT NULL CHECK (content_checksum ~* '^[0-9a-f]{64}$'),
    encryption_key_reference text NOT NULL CHECK (length(encryption_key_reference) > 0),
    lifecycle_state text NOT NULL DEFAULT 'pending'
        CHECK (lifecycle_state IN ('pending', 'sending', 'sent', 'partially_delivered', 'failed', 'cancelled')),
    scheduled_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at timestamptz,
    retention_until timestamptz NOT NULL DEFAULT (CURRENT_TIMESTAMP + interval '90 days'),
    legal_hold boolean NOT NULL DEFAULT false,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    UNIQUE (tenant_id, id),
    CHECK (retention_until >= created_at),
    CHECK (lifecycle_state NOT IN ('sent', 'partially_delivered', 'failed', 'cancelled') OR completed_at IS NOT NULL)
);
CREATE INDEX notifications_delivery_idx
    ON notification.notifications (tenant_id, lifecycle_state, scheduled_at)
    WHERE lifecycle_state IN ('pending', 'sending');
CREATE INDEX notifications_recipient_idx ON notification.notifications (tenant_id, recipient_id, created_at DESC);
CREATE INDEX notifications_retention_idx ON notification.notifications (retention_until) WHERE NOT legal_hold;

CREATE TABLE notification.provider_idempotency_records (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    notification_id uuid NOT NULL,
    provider text NOT NULL CHECK (length(provider) BETWEEN 1 AND 80),
    idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 255),
    provider_message_id text,
    lifecycle_state text NOT NULL CHECK (lifecycle_state IN ('created', 'accepted', 'failed')),
    response_object_key text,
    response_checksum char(64) CHECK (response_checksum IS NULL OR response_checksum ~* '^[0-9a-f]{64}$'),
    encryption_key_reference text,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at timestamptz NOT NULL DEFAULT (CURRENT_TIMESTAMP + interval '90 days'),
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, provider, idempotency_key),
    FOREIGN KEY (tenant_id, notification_id)
        REFERENCES notification.notifications (tenant_id, id) ON DELETE RESTRICT,
    CHECK (
        (response_object_key IS NULL AND response_checksum IS NULL AND encryption_key_reference IS NULL)
        OR (response_object_key IS NOT NULL AND response_checksum IS NOT NULL AND encryption_key_reference IS NOT NULL)
    )
);
CREATE INDEX provider_idempotency_expiry_idx
    ON notification.provider_idempotency_records (expires_at);

CREATE TABLE notification.delivery_attempts (
    id uuid NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    tenant_id uuid NOT NULL,
    notification_id uuid NOT NULL,
    recipient_id uuid NOT NULL,
    channel text NOT NULL CHECK (channel IN ('email', 'in_app')),
    provider text NOT NULL CHECK (length(provider) BETWEEN 1 AND 80),
    provider_idempotency_record_id uuid,
    provider_message_id text,
    attempt_number integer NOT NULL CHECK (attempt_number > 0),
    delivery_state text NOT NULL CHECK (delivery_state IN ('queued', 'sent', 'delivered', 'bounced', 'failed', 'suppressed')),
    failure_code text,
    provider_response_object_key text,
    provider_response_checksum char(64) CHECK (provider_response_checksum IS NULL OR provider_response_checksum ~* '^[0-9a-f]{64}$'),
    encryption_key_reference text,
    retention_until timestamptz NOT NULL DEFAULT (CURRENT_TIMESTAMP + interval '90 days'),
    legal_hold boolean NOT NULL DEFAULT false,
    PRIMARY KEY (id, occurred_at),
    CHECK (retention_until >= occurred_at),
    CHECK (
        (provider_response_object_key IS NULL AND provider_response_checksum IS NULL AND encryption_key_reference IS NULL)
        OR (provider_response_object_key IS NOT NULL AND provider_response_checksum IS NOT NULL AND encryption_key_reference IS NOT NULL)
    )
) PARTITION BY RANGE (occurred_at);

CREATE FUNCTION app.ensure_notification_delivery_partitions(
    partition_through timestamptz DEFAULT (CURRENT_TIMESTAMP + interval '2 months')
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, app, notification AS $$
DECLARE
    partition_start timestamptz := date_trunc('month', CURRENT_TIMESTAMP);
    partition_limit timestamptz := date_trunc('month', partition_through);
    partition_end timestamptz;
    partition_name text;
BEGIN
    WHILE partition_start <= partition_limit LOOP
        partition_end := partition_start + interval '1 month';
        partition_name := format('delivery_attempts_%s', to_char(partition_start, 'YYYYMM'));
        EXECUTE format('CREATE TABLE IF NOT EXISTS notification.%I PARTITION OF notification.delivery_attempts FOR VALUES FROM (%L) TO (%L)', partition_name, partition_start, partition_end);
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON notification.%I (tenant_id, notification_id, occurred_at DESC)', format('%s_tenant_notification_idx', partition_name), partition_name);
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON notification.%I (retention_until) WHERE NOT legal_hold', format('%s_retention_idx', partition_name), partition_name);
        partition_start := partition_end;
    END LOOP;
END;
$$;
SELECT app.ensure_notification_delivery_partitions();
REVOKE ALL ON FUNCTION app.ensure_notification_delivery_partitions(timestamptz) FROM PUBLIC;

CREATE FUNCTION app.purge_expired_notification_delivery_attempts(batch_size integer DEFAULT 10000)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, app, notification AS $$
DECLARE deleted_count bigint;
BEGIN
    IF batch_size IS NULL OR batch_size < 1 OR batch_size > 100000 THEN
        RAISE EXCEPTION 'batch_size must be between 1 and 100000';
    END IF;

    PERFORM set_config('app.allow_retention_purge', 'on', true);

    WITH expired AS (
        SELECT id, occurred_at
        FROM notification.delivery_attempts
        WHERE retention_until <= CURRENT_TIMESTAMP AND NOT legal_hold
        ORDER BY retention_until, occurred_at
        LIMIT batch_size
        FOR UPDATE SKIP LOCKED
    )
    DELETE FROM notification.delivery_attempts attempt
    USING expired
    WHERE attempt.id = expired.id AND attempt.occurred_at = expired.occurred_at;

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;
REVOKE ALL ON FUNCTION app.purge_expired_notification_delivery_attempts(integer) FROM PUBLIC;

CREATE FUNCTION notification.reject_delivery_attempt_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
    IF current_setting('app.allow_retention_purge', true) = 'on' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'delivery attempts are append-only' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER delivery_attempts_append_only
    BEFORE UPDATE OR DELETE ON notification.delivery_attempts
    FOR EACH ROW EXECUTE FUNCTION notification.reject_delivery_attempt_mutation();

ALTER TABLE notification.recipient_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification.recipient_preferences FORCE ROW LEVEL SECURITY;
ALTER TABLE notification.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification.notifications FORCE ROW LEVEL SECURITY;
ALTER TABLE notification.provider_idempotency_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification.provider_idempotency_records FORCE ROW LEVEL SECURITY;
ALTER TABLE notification.delivery_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification.delivery_attempts FORCE ROW LEVEL SECURITY;

DO $policies$
DECLARE
    protected_table text;
    policy_prefix text;
BEGIN
    FOREACH protected_table IN ARRAY ARRAY[
        'notification.recipient_preferences',
        'notification.notifications',
        'notification.provider_idempotency_records',
        'notification.delivery_attempts'
    ]
    LOOP
        policy_prefix := replace(protected_table, '.', '_');
        EXECUTE format(
            'CREATE POLICY %I ON %s FOR SELECT TO aether_notification_app USING (authz.current_context_allows_read(tenant_id, %L, %L, %L))',
            policy_prefix || '_signed_read', protected_table,
            'notification.read', 'notification.write', protected_table
        );
        EXECUTE format(
            'CREATE POLICY %I ON %s FOR INSERT TO aether_notification_app WITH CHECK (authz.current_context_allows(tenant_id, %L, %L))',
            policy_prefix || '_signed_insert', protected_table,
            'notification.write', protected_table
        );
        EXECUTE format(
            'CREATE POLICY %I ON %s FOR UPDATE TO aether_notification_app USING (authz.current_context_allows(tenant_id, %L, %L)) WITH CHECK (authz.current_context_allows(tenant_id, %L, %L))',
            policy_prefix || '_signed_update', protected_table,
            'notification.write', protected_table, 'notification.write', protected_table
        );
        EXECUTE format(
            'CREATE POLICY %I ON %s FOR DELETE TO aether_notification_app USING (authz.current_context_allows(tenant_id, %L, %L))',
            policy_prefix || '_signed_delete', protected_table,
            'notification.write', protected_table
        );
        EXECUTE format(
            'CREATE POLICY %I ON %s FOR ALL TO aether_notification_owner USING (true) WITH CHECK (true)',
            policy_prefix || '_owner_maintenance', protected_table
        );
    END LOOP;
END
$policies$;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
    notification.recipient_preferences,
    notification.notifications,
    notification.provider_idempotency_records
TO aether_notification_app;
GRANT SELECT, INSERT ON TABLE notification.delivery_attempts TO aether_notification_app;

RESET ROLE;
