-- seb_exam_key: empty string means SEB not required.
-- Non-empty: the Browser Exam Key (BEK) SHA-256 hash(es) copied from SEB Config Tool,
-- one per line, to support multiple SEB versions/platforms.
ALTER TABLE exams DROP COLUMN IF EXISTS require_seb;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS seb_exam_key text NOT NULL DEFAULT '';
