-- File: services/identity/migrations/000008_soft_delete_schema.down.sql
SET ROLE aether_identity_owner;

DROP FUNCTION IF EXISTS app.hard_delete;
DROP TABLE IF EXISTS app.hard_delete_audit_log;

ALTER TABLE identity.mfa_factors
    DROP COLUMN IF EXISTS deleted_at,
    DROP COLUMN IF EXISTS deleted_by,
    DROP COLUMN IF EXISTS deletion_reason;

ALTER TABLE identity.refresh_tokens
    DROP COLUMN IF EXISTS deleted_by,
    DROP COLUMN IF EXISTS deletion_reason;

ALTER TABLE identity.password_credentials
    DROP COLUMN IF EXISTS deleted_at,
    DROP COLUMN IF EXISTS deleted_by,
    DROP COLUMN IF EXISTS deletion_reason;

ALTER TABLE identity.principals
    DROP COLUMN IF EXISTS deleted_at,
    DROP COLUMN IF EXISTS deleted_by,
    DROP COLUMN IF EXISTS deletion_reason;
