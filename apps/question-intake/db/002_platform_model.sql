-- The intake database now mirrors the platform's question bank (qbank.categories, questions, question_versions,
-- tests, templates), so a saved question imports without a change. The first model held no real data.
DROP TABLE IF EXISTS verifications, question_solutions, question_tests, questions CASCADE;

-- Topics are the platform's categories: a name unique among its siblings (ignoring case), and an optional parent.
CREATE TABLE categories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 80 AND name !~ '[[:cntrl:]]'),
    normalized_name text NOT NULL CHECK (normalized_name = lower(normalized_name)),
    parent_id uuid REFERENCES categories (id) ON DELETE RESTRICT,
    created_by uuid NOT NULL,
    created_by_name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX categories_sibling_name ON categories (COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), normalized_name);
CREATE INDEX categories_parent_idx ON categories (parent_id) WHERE parent_id IS NOT NULL;

-- One row per question with its current version's fields (the platform keeps a row per version).
CREATE TABLE questions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' AND char_length(slug) BETWEEN 3 AND 80),
    category_id uuid NOT NULL REFERENCES categories (id) ON DELETE RESTRICT,
    kind text NOT NULL DEFAULT 'coding' CHECK (kind IN ('coding', 'mcq')),
    -- "test" questions never reach practice (ADR-0041).
    audience text NOT NULL DEFAULT 'practice' CHECK (audience IN ('test', 'practice')),
    tags text[] NOT NULL DEFAULT '{}',
    title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
    prompt_markdown text NOT NULL CHECK (char_length(prompt_markdown) > 0),
    difficulty text NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
    supported_languages text[] NOT NULL DEFAULT '{}',
    time_limit_ms integer NOT NULL DEFAULT 2000 CHECK (time_limit_ms BETWEEN 50 AND 600000),
    memory_limit_kib integer NOT NULL DEFAULT 262144 CHECK (memory_limit_kib BETWEEN 1024 AND 4194304),
    choices text[],
    correct_choices integer[],
    multiple_choice boolean NOT NULL DEFAULT false,
    -- One entry per option, null where none was written (ADR-0058).
    choice_explanations text[],
    -- Coding questions: the hash of what the judge verified, and when. A multiple-choice question has none.
    verified_hash text,
    verified_at timestamptz,
    author_principal_id uuid NOT NULL,
    author_name text NOT NULL,
    updated_by_principal_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((kind = 'coding') = (verified_hash IS NOT NULL)),
    CHECK (kind = 'coding' OR (choices IS NOT NULL AND correct_choices IS NOT NULL))
);
CREATE INDEX questions_category_idx ON questions (category_id, difficulty, updated_at DESC);
CREATE INDEX questions_tags_idx ON questions USING gin (tags);

CREATE TABLE question_tests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id uuid NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
    position integer NOT NULL CHECK (position >= 0),
    input text NOT NULL,
    expected_output text NOT NULL,
    is_sample boolean NOT NULL DEFAULT false,
    weight integer NOT NULL DEFAULT 1 CHECK (weight BETWEEN 1 AND 100),
    UNIQUE (question_id, position)
);

-- Function-only questions (ADR-0063): the stub students see, and the code the judge wraps around their function.
CREATE TABLE question_templates (
    question_id uuid NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
    language text NOT NULL,
    starter text NOT NULL DEFAULT '',
    prefix text NOT NULL DEFAULT '',
    suffix text NOT NULL DEFAULT '',
    PRIMARY KEY (question_id, language)
);

-- Model solutions: what the judge verified (the platform's model checks).
CREATE TABLE question_solutions (
    question_id uuid NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
    language text NOT NULL,
    source text NOT NULL CHECK (char_length(source) BETWEEN 1 AND 100000),
    PRIMARY KEY (question_id, language)
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
