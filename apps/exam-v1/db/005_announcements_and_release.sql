CREATE TABLE announcements (
    id bigserial PRIMARY KEY,
    exam_id uuid NOT NULL REFERENCES exams (id) ON DELETE CASCADE,
    message text NOT NULL CHECK (length(message) BETWEEN 1 AND 1000),
    created_by uuid REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX announcements_exam_idx ON announcements (exam_id, id);

ALTER TABLE exams ADD COLUMN results_released boolean NOT NULL DEFAULT false;
