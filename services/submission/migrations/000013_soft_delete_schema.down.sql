-- File: services/submission/migrations/000013_soft_delete_schema.down.sql
SET ROLE aether_submission_owner;

DROP FUNCTION IF EXISTS app.hard_delete;
DROP TABLE IF EXISTS app.hard_delete_audit_log;

ALTER TABLE submission.attempts DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by, DROP COLUMN IF EXISTS deletion_reason;
