SET ROLE aether_identity_owner;

CREATE TABLE app.inbox_messages (
    consumer_name text NOT NULL CHECK (consumer_name ~ '^[a-z][a-z0-9._-]{0,127}$'),
    message_id uuid NOT NULL,
    subject text NOT NULL CHECK (subject ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$'),
    occurred_at timestamptz NOT NULL,
    payload_sha256 bytea NOT NULL CHECK (octet_length(payload_sha256) = 32),
    received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    processed_at timestamptz,
    failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
    last_error text,
    PRIMARY KEY (consumer_name, message_id),
    CHECK (processed_at IS NULL OR processed_at >= received_at)
);

CREATE INDEX inbox_messages_pending_idx
    ON app.inbox_messages (received_at)
    WHERE processed_at IS NULL;

CREATE TABLE app.command_idempotency (
    command_scope text NOT NULL CHECK (command_scope ~ '^[a-z][a-z0-9._-]{0,127}$'),
    idempotency_key uuid NOT NULL,
    request_sha256 bytea NOT NULL CHECK (octet_length(request_sha256) = 32),
    response_code integer,
    response_body jsonb,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    completed_at timestamptz,
    expires_at timestamptz NOT NULL,
    PRIMARY KEY (command_scope, idempotency_key),
    CHECK (expires_at > created_at),
    CHECK ((completed_at IS NULL) = (response_code IS NULL)),
    CHECK ((response_body IS NULL) OR jsonb_typeof(response_body) = 'object')
);

CREATE INDEX command_idempotency_expiry_idx ON app.command_idempotency (expires_at);

CREATE TABLE app.outbox_events (
    event_id uuid PRIMARY KEY,
    aggregate_type text NOT NULL CHECK (aggregate_type ~ '^[a-z][a-z0-9._-]{0,127}$'),
    aggregate_id uuid NOT NULL,
    tenant_id uuid,
    event_type text NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9._-]{0,127}$'),
    schema_version integer NOT NULL CHECK (schema_version > 0),
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    payload_sha256 bytea NOT NULL CHECK (octet_length(payload_sha256) = 32),
    occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    published_at timestamptz,
    publication_attempts integer NOT NULL DEFAULT 0 CHECK (publication_attempts >= 0),
    next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    locked_until timestamptz,
    last_error text
);

CREATE INDEX outbox_events_pending_idx
    ON app.outbox_events (next_attempt_at, occurred_at)
    WHERE published_at IS NULL;

CREATE FUNCTION identity.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END
$function$;

CREATE TABLE identity.principals (
    id uuid PRIMARY KEY,
    email text NOT NULL CHECK (
        email = btrim(email)
        AND char_length(email) BETWEEN 3 AND 320
        AND position('@' IN email) > 1
    ),
    display_name text NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 200),
    status text NOT NULL DEFAULT 'pending_verification'
        CHECK (status IN ('pending_verification', 'active', 'disabled', 'locked')),
    email_verified_at timestamptz,
    last_authenticated_at timestamptz,
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    deleted_at timestamptz,
    CHECK ((email_verified_at IS NULL) OR email_verified_at >= created_at),
    CHECK ((deleted_at IS NULL) OR deleted_at >= created_at)
);

CREATE UNIQUE INDEX principals_active_email_unique
    ON identity.principals (lower(email))
    WHERE deleted_at IS NULL;

CREATE TABLE identity.password_credentials (
    principal_id uuid PRIMARY KEY REFERENCES identity.principals (id) ON DELETE RESTRICT,
    password_hash text NOT NULL CHECK (password_hash LIKE '$argon2id$%'),
    changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    must_change boolean NOT NULL DEFAULT false,
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE identity.mfa_factors (
    id uuid PRIMARY KEY,
    principal_id uuid NOT NULL REFERENCES identity.principals (id) ON DELETE RESTRICT,
    factor_type text NOT NULL CHECK (factor_type IN ('totp')),
    label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 120),
    secret_ciphertext bytea NOT NULL CHECK (octet_length(secret_ciphertext) > 0),
    encrypted_data_key bytea NOT NULL CHECK (octet_length(encrypted_data_key) > 0),
    key_reference text NOT NULL CHECK (char_length(key_reference) BETWEEN 1 AND 255),
    secret_sha256 bytea NOT NULL CHECK (octet_length(secret_sha256) = 32),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'disabled')),
    verified_at timestamptz,
    last_used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    CHECK ((status = 'active') = (verified_at IS NOT NULL))
);

CREATE UNIQUE INDEX mfa_factors_active_label_unique
    ON identity.mfa_factors (principal_id, lower(label))
    WHERE status <> 'disabled';

CREATE TABLE identity.mfa_recovery_codes (
    factor_id uuid NOT NULL REFERENCES identity.mfa_factors (id) ON DELETE CASCADE,
    code_hash bytea NOT NULL CHECK (octet_length(code_hash) = 32),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    used_at timestamptz,
    PRIMARY KEY (factor_id, code_hash)
);

CREATE TABLE identity.refresh_session_families (
    id uuid PRIMARY KEY,
    principal_id uuid NOT NULL REFERENCES identity.principals (id) ON DELETE RESTRICT,
    tenant_id uuid,
    authz_revision bigint NOT NULL CHECK (authz_revision > 0),
    state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'revoked', 'expired')),
    issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL,
    last_seen_at timestamptz,
    revoked_at timestamptz,
    revoke_reason text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    CHECK (expires_at > issued_at),
    CHECK ((state = 'revoked') = (revoked_at IS NOT NULL)),
    CHECK ((revoked_at IS NULL) OR revoked_at >= issued_at)
);

CREATE INDEX refresh_session_families_principal_idx
    ON identity.refresh_session_families (principal_id, expires_at DESC)
    WHERE state = 'active';

CREATE TABLE identity.refresh_tokens (
    id uuid PRIMARY KEY,
    family_id uuid NOT NULL REFERENCES identity.refresh_session_families (id) ON DELETE RESTRICT,
    parent_token_id uuid REFERENCES identity.refresh_tokens (id) ON DELETE RESTRICT,
    token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    revoked_at timestamptz,
    replacement_token_id uuid,
    CHECK (expires_at > issued_at),
    CHECK ((replacement_token_id IS NULL) OR replacement_token_id <> id)
);

CREATE INDEX refresh_tokens_family_active_idx
    ON identity.refresh_tokens (family_id, expires_at DESC)
    WHERE used_at IS NULL AND revoked_at IS NULL;

CREATE TABLE identity.password_reset_tokens (
    id uuid PRIMARY KEY,
    principal_id uuid NOT NULL REFERENCES identity.principals (id) ON DELETE RESTRICT,
    token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    request_ip inet,
    CHECK (expires_at > issued_at),
    CHECK ((consumed_at IS NULL) OR consumed_at >= issued_at)
);

CREATE INDEX password_reset_tokens_expiry_idx ON identity.password_reset_tokens (expires_at);

CREATE TABLE identity.account_lockouts (
    principal_id uuid PRIMARY KEY REFERENCES identity.principals (id) ON DELETE RESTRICT,
    failed_attempt_count integer NOT NULL DEFAULT 0 CHECK (failed_attempt_count >= 0),
    locked_until timestamptz,
    last_failed_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    CHECK ((locked_until IS NULL) OR (last_failed_at IS NOT NULL AND locked_until >= last_failed_at))
);

CREATE TABLE identity.auth_events (
    occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    event_id uuid NOT NULL,
    principal_id uuid,
    tenant_id uuid,
    event_type text NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9._-]{0,127}$'),
    outcome text NOT NULL CHECK (outcome IN ('success', 'failure', 'denied')),
    request_id uuid,
    ip_address inet,
    user_agent text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
    PRIMARY KEY (occurred_at, event_id)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE identity.auth_events_default PARTITION OF identity.auth_events DEFAULT;

CREATE FUNCTION identity.ensure_auth_event_partition(p_month date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, identity
AS $function$
DECLARE
    month_start date := date_trunc('month', p_month)::date;
    month_end date;
    partition_name text;
    current_month date := date_trunc('month', clock_timestamp())::date;
BEGIN
    IF month_start < (current_month - interval '1 month')::date
       OR month_start > (current_month + interval '3 months')::date THEN
        RAISE EXCEPTION 'auth event partitions may be maintained only from the prior month through three months ahead';
    END IF;

    month_end := (month_start + interval '1 month')::date;
    partition_name := format('auth_events_%s', to_char(month_start, 'YYYY_MM'));
    PERFORM pg_advisory_xact_lock(hashtext('identity.auth_events.partition'));

    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS identity.%I PARTITION OF identity.auth_events FOR VALUES FROM (%L) TO (%L)',
        partition_name,
        month_start,
        month_end
    );
    EXECUTE format('GRANT INSERT ON TABLE identity.%I TO aether_identity_app', partition_name);
END
$function$;

DO $partitions$
DECLARE
    month_offset integer;
BEGIN
    FOR month_offset IN -1..2 LOOP
        PERFORM identity.ensure_auth_event_partition(
            (date_trunc('month', clock_timestamp()) + (month_offset || ' months')::interval)::date
        );
    END LOOP;
END
$partitions$;

CREATE TRIGGER principals_touch_updated_at
BEFORE UPDATE ON identity.principals
FOR EACH ROW EXECUTE FUNCTION identity.touch_updated_at();

CREATE TRIGGER password_credentials_touch_updated_at
BEFORE UPDATE ON identity.password_credentials
FOR EACH ROW EXECUTE FUNCTION identity.touch_updated_at();

CREATE TRIGGER mfa_factors_touch_updated_at
BEFORE UPDATE ON identity.mfa_factors
FOR EACH ROW EXECUTE FUNCTION identity.touch_updated_at();

CREATE TRIGGER account_lockouts_touch_updated_at
BEFORE UPDATE ON identity.account_lockouts
FOR EACH ROW EXECUTE FUNCTION identity.touch_updated_at();

REVOKE ALL ON ALL TABLES IN SCHEMA app FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA identity FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA app FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA identity FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA identity FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE ON app.inbox_messages, app.command_idempotency, app.outbox_events
    TO aether_identity_app;
GRANT SELECT, INSERT, UPDATE ON identity.principals,
    identity.password_credentials,
    identity.mfa_factors,
    identity.mfa_recovery_codes,
    identity.refresh_session_families,
    identity.refresh_tokens,
    identity.password_reset_tokens,
    identity.account_lockouts
    TO aether_identity_app;
GRANT INSERT ON identity.auth_events TO aether_identity_app;
GRANT EXECUTE ON FUNCTION identity.ensure_auth_event_partition(date) TO aether_identity_app;

RESET ROLE;
