-- Faculty-only model solution used to verify a question's test cases.
ALTER TABLE questions
    ADD COLUMN reference_language text,
    ADD COLUMN reference_source text CHECK (reference_source IS NULL OR length(reference_source) <= 65536);
