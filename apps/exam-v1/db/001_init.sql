CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    username text NOT NULL UNIQUE CHECK (username ~ '^[A-Za-z0-9._@-]{1,64}$'),
    name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
    role text NOT NULL CHECK (role IN ('admin', 'faculty', 'student')),
    batch text CHECK (batch IS NULL OR length(batch) BETWEEN 1 AND 64),
    password_hash text NOT NULL,
    disabled boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX users_role_batch_idx ON users (role, batch);

CREATE TABLE sessions (
    token_hash text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE questions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
    statement text NOT NULL,
    time_limit_ms integer NOT NULL CHECK (time_limit_ms BETWEEN 100 AND 20000),
    memory_limit_kb integer NOT NULL CHECK (memory_limit_kb BETWEEN 16384 AND 1048576),
    created_by uuid REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE test_cases (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id uuid NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
    ord integer NOT NULL,
    input text NOT NULL,
    expected_output text NOT NULL,
    is_sample boolean NOT NULL DEFAULT false,
    weight integer NOT NULL DEFAULT 1 CHECK (weight BETWEEN 1 AND 100),
    UNIQUE (question_id, ord)
);

CREATE TABLE exams (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
    instructions text NOT NULL DEFAULT '',
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 1 AND 1440),
    languages text[] NOT NULL,
    batches text[] NOT NULL,
    published boolean NOT NULL DEFAULT false,
    created_by uuid REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (ends_at > starts_at)
);

CREATE TABLE exam_questions (
    exam_id uuid NOT NULL REFERENCES exams (id) ON DELETE CASCADE,
    question_id uuid NOT NULL REFERENCES questions (id),
    ord integer NOT NULL,
    points integer NOT NULL CHECK (points BETWEEN 1 AND 1000),
    PRIMARY KEY (exam_id, question_id)
);

CREATE TABLE attempts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    exam_id uuid NOT NULL REFERENCES exams (id),
    user_id uuid NOT NULL REFERENCES users (id),
    started_at timestamptz NOT NULL DEFAULT now(),
    deadline_at timestamptz NOT NULL,
    finished_at timestamptz,
    -- Set once the worker has submitted the final drafts after the attempt ended.
    finalized_at timestamptz,
    UNIQUE (exam_id, user_id)
);

CREATE INDEX attempts_unfinalized_idx ON attempts (deadline_at) WHERE finalized_at IS NULL;

CREATE TABLE drafts (
    attempt_id uuid NOT NULL REFERENCES attempts (id) ON DELETE CASCADE,
    question_id uuid NOT NULL REFERENCES questions (id),
    language text NOT NULL,
    source text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (attempt_id, question_id)
);

CREATE TABLE submissions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id uuid NOT NULL REFERENCES attempts (id),
    question_id uuid NOT NULL REFERENCES questions (id),
    kind text NOT NULL CHECK (kind IN ('run', 'submit')),
    language text NOT NULL,
    source text NOT NULL CHECK (length(source) <= 65536),
    custom_input text,
    status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'error')),
    verdict text,
    passed integer NOT NULL DEFAULT 0,
    total integer NOT NULL DEFAULT 0,
    earned_weight integer NOT NULL DEFAULT 0,
    total_weight integer NOT NULL DEFAULT 0,
    compile_output text,
    claimed_at timestamptz,
    tries integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz
);
CREATE INDEX submissions_queue_idx ON submissions (created_at) WHERE status IN ('queued', 'running');
CREATE INDEX submissions_attempt_idx ON submissions (attempt_id, question_id, created_at DESC);

CREATE TABLE submission_results (
    submission_id uuid NOT NULL REFERENCES submissions (id) ON DELETE CASCADE,
    ord integer NOT NULL,
    test_case_id uuid,
    is_sample boolean NOT NULL,
    verdict text NOT NULL,
    stdout text,
    stderr text,
    time_ms integer,
    memory_kb integer,
    PRIMARY KEY (submission_id, ord)
);

CREATE TABLE attempt_events (
    id bigserial PRIMARY KEY,
    attempt_id uuid NOT NULL REFERENCES attempts (id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('blur', 'paste', 'fullscreen_exit')),
    at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attempt_events_attempt_idx ON attempt_events (attempt_id);
