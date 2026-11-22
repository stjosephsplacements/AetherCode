-- Idempotent links from an intake question to the platform question bank (ADR-0069 product import).
CREATE TABLE question_bank_links (
    intake_question_id uuid PRIMARY KEY REFERENCES questions (id) ON DELETE CASCADE,
    bank_question_id uuid NOT NULL,
    bank_version_id uuid NOT NULL,
    idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 200),
    linked_by uuid NOT NULL,
    linked_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (idempotency_key)
);
CREATE INDEX question_bank_links_bank_question_idx ON question_bank_links (bank_question_id);