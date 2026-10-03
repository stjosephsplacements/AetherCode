-- File: services/judge/migrations/000004_soft_delete_schema.down.sql
SET ROLE aether_judge_migrator;

DROP FUNCTION IF EXISTS app.hard_delete;
DROP TABLE IF EXISTS app.hard_delete_audit_log;

ALTER TABLE judge.language_mappings
    DROP COLUMN IF EXISTS deleted_at,
    DROP COLUMN IF EXISTS deleted_by,
    DROP COLUMN IF EXISTS deletion_reason;

ALTER TABLE judge.execution_jobs
    DROP COLUMN IF EXISTS deleted_at,
    DROP COLUMN IF EXISTS deleted_by,
    DROP COLUMN IF EXISTS deletion_reason;

-- Paired with the schema creation in the up migration.
DROP SCHEMA IF EXISTS app CASCADE;

RESET ROLE;
