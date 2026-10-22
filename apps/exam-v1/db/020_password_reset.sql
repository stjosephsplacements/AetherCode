ALTER TABLE users ADD COLUMN email text UNIQUE;
ALTER TABLE users ADD CONSTRAINT users_email_format
  CHECK (email IS NULL OR email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');

CREATE TABLE password_reset_tokens (
    token_hash  text        PRIMARY KEY,
    user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    expires_at  timestamptz NOT NULL,
    used_at     timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_reset_tokens_user ON password_reset_tokens (user_id);
