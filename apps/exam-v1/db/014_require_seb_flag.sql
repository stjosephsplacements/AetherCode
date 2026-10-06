-- SEB requests are verified with the Config Key of the config the app itself
-- generates, so an exam only needs an on/off flag. The pasted Browser Exam
-- Keys, the global settings row and the stored per-exam Config Key are unused.
ALTER TABLE exams ADD COLUMN IF NOT EXISTS require_seb boolean NOT NULL DEFAULT false;
UPDATE exams SET require_seb = true WHERE seb_exam_key <> '';
ALTER TABLE exams DROP COLUMN seb_exam_key, DROP COLUMN seb_config_key;
DROP TABLE settings;
