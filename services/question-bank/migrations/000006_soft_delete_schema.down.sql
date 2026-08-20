-- File: services/question-bank/migrations/000006_soft_delete_schema.down.sql
SET ROLE aether_question_bank_owner;

DROP FUNCTION IF EXISTS app.hard_delete;
DROP TABLE IF EXISTS app.hard_delete_audit_log;

ALTER TABLE qbank.question_versions DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by, DROP COLUMN IF EXISTS deletion_reason;
ALTER TABLE qbank.questions DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by, DROP COLUMN IF EXISTS deletion_reason;
