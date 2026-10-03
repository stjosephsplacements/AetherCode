SET ROLE aether_identity_owner;

CREATE TABLE identity.mfa_login_challenges (
    id uuid PRIMARY KEY,
    principal_id uuid NOT NULL REFERENCES identity.principals (id) ON DELETE RESTRICT,
    tenant_id uuid,
    token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count BETWEEN 0 AND 5),
    request_ip inet,
    user_agent text,
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    CHECK (expires_at > issued_at),
    CHECK (consumed_at IS NULL OR consumed_at >= issued_at)
);

CREATE INDEX mfa_login_challenges_principal_pending_idx
    ON identity.mfa_login_challenges (principal_id, expires_at DESC)
    WHERE consumed_at IS NULL;

CREATE INDEX mfa_login_challenges_expiry_idx
    ON identity.mfa_login_challenges (expires_at)
    WHERE consumed_at IS NULL;

REVOKE ALL ON TABLE identity.mfa_login_challenges FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON identity.mfa_login_challenges TO aether_identity_app;

RESET ROLE;
