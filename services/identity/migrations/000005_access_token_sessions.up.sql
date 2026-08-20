SET ROLE aether_identity_owner;

CREATE TABLE identity.access_token_sessions (
    token_id uuid PRIMARY KEY,
    family_id uuid NOT NULL REFERENCES identity.refresh_session_families (id) ON DELETE RESTRICT,
    principal_id uuid NOT NULL REFERENCES identity.principals (id) ON DELETE RESTRICT,
    issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    revoke_reason text,
    CHECK (expires_at > issued_at),
    CHECK (revoked_at IS NULL OR revoked_at >= issued_at)
);

CREATE INDEX access_token_sessions_principal_active_idx
    ON identity.access_token_sessions (principal_id, expires_at DESC)
    WHERE revoked_at IS NULL;

CREATE INDEX access_token_sessions_family_active_idx
    ON identity.access_token_sessions (family_id, expires_at DESC)
    WHERE revoked_at IS NULL;

REVOKE ALL ON TABLE identity.access_token_sessions FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON identity.access_token_sessions TO aether_identity_app;

RESET ROLE;
