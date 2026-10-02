-- A staff member's try-out of an exam; excluded from results and reports.
ALTER TABLE attempts ADD COLUMN is_preview boolean NOT NULL DEFAULT false;
