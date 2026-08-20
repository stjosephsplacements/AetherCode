-- File: services/assessment/migrations/000012_soft_delete_schema.down.sql
SET ROLE aether_assessment_owner;

DROP FUNCTION IF EXISTS app.hard_delete;
DROP TABLE IF EXISTS app.hard_delete_audit_log;

ALTER TABLE assessment.candidate_assignments DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by, DROP COLUMN IF EXISTS deletion_reason;
ALTER TABLE assessment.exam_versions DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by, DROP COLUMN IF EXISTS deletion_reason;
ALTER TABLE assessment.exams DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by, DROP COLUMN IF EXISTS deletion_reason;
