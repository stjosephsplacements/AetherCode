ALTER TABLE questions ADD COLUMN topic text;
ALTER TABLE questions ADD COLUMN difficulty text CHECK (
    difficulty IS NULL OR difficulty IN ('easy', 'medium', 'hard')
);

CREATE INDEX idx_questions_topic ON questions (topic) WHERE topic IS NOT NULL;
CREATE INDEX idx_questions_difficulty ON questions (difficulty) WHERE difficulty IS NOT NULL;
