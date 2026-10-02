ALTER TABLE questions
    ADD COLUMN kind text NOT NULL DEFAULT 'coding' CHECK (kind IN ('coding', 'mcq')),
    ADD COLUMN mcq_options text[],
    ADD COLUMN mcq_correct integer[],
    ADD CONSTRAINT mcq_complete CHECK (
        kind = 'coding' OR (
            array_length(mcq_options, 1) BETWEEN 2 AND 10
            AND array_length(mcq_correct, 1) >= 1
        )
    );

-- A student's current choice per multiple-choice question (indexes into mcq_options).
CREATE TABLE mcq_answers (
    attempt_id uuid NOT NULL REFERENCES attempts (id) ON DELETE CASCADE,
    question_id uuid NOT NULL REFERENCES questions (id),
    selected integer[] NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (attempt_id, question_id)
);
