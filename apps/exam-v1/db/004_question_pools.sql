-- Questions sharing a slot form a pool; each student is assigned one question
-- per slot when their attempt starts.
ALTER TABLE exam_questions ADD COLUMN slot integer;
UPDATE exam_questions SET slot = ord;
ALTER TABLE exam_questions ALTER COLUMN slot SET NOT NULL;

CREATE TABLE attempt_questions (
    attempt_id uuid NOT NULL REFERENCES attempts (id) ON DELETE CASCADE,
    slot integer NOT NULL,
    question_id uuid NOT NULL REFERENCES questions (id),
    points integer NOT NULL,
    PRIMARY KEY (attempt_id, slot),
    UNIQUE (attempt_id, question_id)
);

INSERT INTO attempt_questions (attempt_id, slot, question_id, points)
SELECT a.id, eq.slot, eq.question_id, eq.points
FROM attempts a JOIN exam_questions eq ON eq.exam_id = a.exam_id;
