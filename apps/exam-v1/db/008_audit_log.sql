-- Append-only record of staff actions, for disputes and accountability.
CREATE TABLE audit_log (
    id bigserial PRIMARY KEY,
    at timestamptz NOT NULL DEFAULT now(),
    -- Kept when the account is deleted; `actor` already holds the name.
    actor_id uuid REFERENCES users (id) ON DELETE SET NULL,
    actor text NOT NULL,
    action text NOT NULL,
    target text NOT NULL DEFAULT '',
    details jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_log_at_idx ON audit_log (at DESC);
