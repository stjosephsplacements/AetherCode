SET ROLE aether_identity_owner;

CREATE TABLE identity.email_verification_tokens (
    id uuid PRIMARY KEY,
    principal_id uuid NOT NULL REFERENCES identity.principals (id) ON DELETE RESTRICT,
    token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    request_ip inet,
    CHECK (expires_at > issued_at),
    CHECK (consumed_at IS NULL OR consumed_at >= issued_at)
);

CREATE INDEX email_verification_tokens_principal_expiry_idx
    ON identity.email_verification_tokens (principal_id, expires_at DESC)
    WHERE consumed_at IS NULL;

REVOKE ALL ON TABLE identity.email_verification_tokens FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON identity.email_verification_tokens TO aether_identity_app;

RESET ROLE;
