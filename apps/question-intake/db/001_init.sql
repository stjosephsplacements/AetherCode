-- The question intake database: questions staff upload, with their tests and model solutions.
-- A question is saved only after its model solution passed every test in the hosted judge.
CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE questions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 200),
    difficulty text NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
    topics text[] NOT NULL DEFAULT '{}',
    statement_md text NOT NULL CHECK (length(statement_md) BETWEEN 10 AND 50000),
    input_format text NOT NULL DEFAULT '',
    output_format text NOT NULL DEFAULT '',
    constraints_md text NOT NULL DEFAULT '',
    time_limit_ms integer NOT NULL DEFAULT 2000 CHECK (time_limit_ms BETWEEN 100 AND 20000),
    memory_limit_kb integer NOT NULL DEFAULT 262144 CHECK (memory_limit_kb BETWEEN 16384 AND 2097152),
    -- The content the last judge verification covered; the question is saved only when it matches.
    verified_hash text NOT NULL,
    verified_at timestamptz NOT NULL DEFAULT now(),
    author_principal_id uuid NOT NULL,
    author_name text NOT NULL,
    updated_by_principal_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (title)
);
CREATE INDEX questions_updated_idx ON questions (updated_at DESC);
CREATE INDEX questions_topics_idx ON questions USING gin (topics);

CREATE TABLE question_tests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id uuid NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
    position integer NOT NULL CHECK (position >= 0),
    input text NOT NULL,
    expected_output text NOT NULL,
    is_sample boolean NOT NULL DEFAULT false,
    UNIQUE (question_id, position)
);

CREATE TABLE question_solutions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id uuid NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
    language text NOT NULL,
    source text NOT NULL CHECK (length(source) BETWEEN 1 AND 100000),
    UNIQUE (question_id, language)
);

-- Every judge run, kept for audit: who verified what, and the verdict per test.
CREATE TABLE verifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id uuid REFERENCES questions (id) ON DELETE SET NULL,
    content_hash text NOT NULL,
    passed boolean NOT NULL,
    results jsonb NOT NULL,
    run_by_principal_id uuid NOT NULL,
    run_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verifications_question_idx ON verifications (question_id, run_at DESC);
