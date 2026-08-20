-- Submission workflows materialize immutable assessment assignment snapshots,
-- enforce candidate ownership inside the database boundary, and emit only
-- durable object references. Candidate source code and hidden tests never pass
-- through the database as plaintext.
SET ROLE aether_submission_owner;

ALTER TABLE submission.attempts ADD COLUMN available_from timestamptz;
UPDATE submission.attempts SET available_from = created_at WHERE available_from IS NULL;
ALTER TABLE submission.attempts ALTER COLUMN available_from SET NOT NULL;
ALTER TABLE submission.attempts
    ADD COLUMN start_idempotency_key text,
    ADD COLUMN start_request_checksum char(64),
    ADD COLUMN submit_idempotency_key text,
    ADD COLUMN submit_request_checksum char(64);
ALTER TABLE submission.attempts
    ADD CONSTRAINT attempts_start_idempotency_pair_check CHECK (
        (start_idempotency_key IS NULL AND start_request_checksum IS NULL)
        OR (
            length(btrim(start_idempotency_key)) BETWEEN 1 AND 255
            AND start_request_checksum ~* '^[0-9a-f]{64}$'
        )
    ),
    ADD CONSTRAINT attempts_submit_idempotency_pair_check CHECK (
        (submit_idempotency_key IS NULL AND submit_request_checksum IS NULL)
        OR (
            length(btrim(submit_idempotency_key)) BETWEEN 1 AND 255
            AND submit_request_checksum ~* '^[0-9a-f]{64}$'
        )
    );
CREATE UNIQUE INDEX attempts_start_idempotency_idx
    ON submission.attempts (tenant_id, candidate_assignment_id, start_idempotency_key)
    WHERE start_idempotency_key IS NOT NULL;

ALTER TABLE submission.evaluation_requests
    ADD COLUMN maximum_score numeric(12,4);
ALTER TABLE submission.evaluation_requests
    ADD CONSTRAINT evaluation_requests_maximum_score_check
    CHECK (maximum_score IS NULL OR maximum_score > 0);

CREATE TABLE submission.assignment_projections (
    tenant_id uuid NOT NULL,
    candidate_assignment_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    exam_id uuid NOT NULL,
    exam_version_id uuid NOT NULL,
    available_from timestamptz NOT NULL,
    available_until timestamptz NOT NULL,
    attempt_limit smallint NOT NULL CHECK (attempt_limit BETWEEN 1 AND 20),
    lifecycle_state text NOT NULL CHECK (lifecycle_state IN ('active', 'revoked')),
    version bigint NOT NULL CHECK (version > 0),
    source_event_id uuid NOT NULL UNIQUE,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (tenant_id, candidate_assignment_id),
    CHECK (available_from < available_until)
);
CREATE INDEX assignment_projections_candidate_idx
    ON submission.assignment_projections (tenant_id, candidate_id, available_from, available_until)
    WHERE lifecycle_state = 'active';

CREATE TABLE submission.assignment_item_projections (
    tenant_id uuid NOT NULL,
    candidate_assignment_id uuid NOT NULL,
    exam_item_id uuid NOT NULL,
    evaluation_bundle_object_key text NOT NULL CHECK (length(btrim(evaluation_bundle_object_key)) > 0),
    evaluation_bundle_checksum char(64) NOT NULL
        CHECK (evaluation_bundle_checksum ~* '^[0-9a-f]{64}$'),
    maximum_score numeric(12,4) NOT NULL CHECK (maximum_score > 0),
    PRIMARY KEY (tenant_id, candidate_assignment_id, exam_item_id),
    FOREIGN KEY (tenant_id, candidate_assignment_id)
        REFERENCES submission.assignment_projections (tenant_id, candidate_assignment_id)
        ON DELETE RESTRICT
);

CREATE FUNCTION submission.require_authorized_context(
    p_tenant_id uuid,
    p_action text,
    p_resource text
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, authz
AS $function$
BEGIN
    IF p_tenant_id IS NULL
       OR NOT authz.current_context_allows(p_tenant_id, p_action, p_resource) THEN
        RAISE EXCEPTION 'signed authorization context does not allow this submission operation'
            USING ERRCODE = '42501';
    END IF;
END
$function$;

CREATE FUNCTION submission.apply_assignment_snapshot(
    p_source_event_id uuid,
    p_tenant_id uuid,
    p_candidate_assignment_id uuid,
    p_candidate_id uuid,
    p_exam_id uuid,
    p_exam_version_id uuid,
    p_available_from timestamptz,
    p_available_until timestamptz,
    p_attempt_limit smallint,
    p_lifecycle_state text,
    p_version bigint,
    p_items jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, submission
AS $function$
DECLARE
    applied boolean;
    item_count integer;
    distinct_item_count integer;
BEGIN
    IF p_source_event_id IS NULL
       OR p_tenant_id IS NULL
       OR p_candidate_assignment_id IS NULL
       OR p_candidate_id IS NULL
       OR p_exam_id IS NULL
       OR p_exam_version_id IS NULL
       OR p_available_from IS NULL
       OR p_available_until IS NULL
       OR p_available_from >= p_available_until
       OR p_attempt_limit NOT BETWEEN 1 AND 20
       OR p_lifecycle_state NOT IN ('active', 'revoked')
       OR p_version <= 0
       OR jsonb_typeof(p_items) <> 'array'
    THEN
        RAISE EXCEPTION 'assessment assignment snapshot is invalid';
    END IF;

    SELECT count(*), count(DISTINCT item ->> 'exam_item_id')
    INTO item_count, distinct_item_count
    FROM jsonb_array_elements(p_items) AS item;
    IF (p_lifecycle_state = 'active' AND item_count = 0) OR item_count <> distinct_item_count THEN
        RAISE EXCEPTION 'assessment assignment snapshot items are invalid';
    END IF;

    INSERT INTO submission.assignment_projections AS projection (
        tenant_id, candidate_assignment_id, candidate_id, exam_id, exam_version_id,
        available_from, available_until, attempt_limit, lifecycle_state, version, source_event_id
    ) VALUES (
        p_tenant_id, p_candidate_assignment_id, p_candidate_id, p_exam_id, p_exam_version_id,
        p_available_from, p_available_until, p_attempt_limit, p_lifecycle_state, p_version, p_source_event_id
    )
    ON CONFLICT (tenant_id, candidate_assignment_id) DO UPDATE
    SET candidate_id = EXCLUDED.candidate_id,
        exam_id = EXCLUDED.exam_id,
        exam_version_id = EXCLUDED.exam_version_id,
        available_from = EXCLUDED.available_from,
        available_until = EXCLUDED.available_until,
        attempt_limit = EXCLUDED.attempt_limit,
        lifecycle_state = EXCLUDED.lifecycle_state,
        version = EXCLUDED.version,
        source_event_id = EXCLUDED.source_event_id,
        updated_at = clock_timestamp()
    WHERE EXCLUDED.version > projection.version
    RETURNING true INTO applied;

    IF NOT COALESCE(applied, false) THEN
        RETURN false;
    END IF;

    DELETE FROM submission.assignment_item_projections
    WHERE tenant_id = p_tenant_id
      AND candidate_assignment_id = p_candidate_assignment_id;

    INSERT INTO submission.assignment_item_projections (
        tenant_id, candidate_assignment_id, exam_item_id,
        evaluation_bundle_object_key, evaluation_bundle_checksum, maximum_score
    )
    SELECT
        p_tenant_id,
        p_candidate_assignment_id,
        (item ->> 'exam_item_id')::uuid,
        item ->> 'evaluation_bundle_object_key',
        item ->> 'evaluation_bundle_checksum',
        (item ->> 'maximum_score')::numeric(12,4)
    FROM jsonb_array_elements(p_items) AS item;

    RETURN true;
END
$function$;

CREATE FUNCTION submission.start_attempt(
    p_attempt_id uuid,
    p_attempt_event_id uuid,
    p_tenant_id uuid,
    p_candidate_assignment_id uuid,
    p_idempotency_key text,
    p_request_checksum text
)
RETURNS TABLE (
    id uuid,
    tenant_id uuid,
    exam_id uuid,
    exam_version_id uuid,
    candidate_id uuid,
    candidate_assignment_id uuid,
    attempt_number smallint,
    lifecycle_state text,
    available_from timestamptz,
    submission_deadline timestamptz,
    started_at timestamptz,
    submitted_at timestamptz,
    completed_at timestamptz,
    version bigint,
    created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz, submission
AS $function$
DECLARE
    assignment_record submission.assignment_projections%ROWTYPE;
    attempt_record submission.attempts%ROWTYPE;
    actor_id uuid;
    next_attempt_number integer;
BEGIN
    PERFORM submission.require_authorized_context(p_tenant_id, 'submission.write', 'submission.attempts');
    actor_id := authz.current_context_actor_id();
    IF p_attempt_id IS NULL OR p_attempt_event_id IS NULL OR p_candidate_assignment_id IS NULL
       OR actor_id IS NULL
       OR length(btrim(p_idempotency_key)) NOT BETWEEN 1 AND 255
       OR p_request_checksum !~* '^[0-9a-f]{64}$'
    THEN
        RAISE EXCEPTION 'attempt start command is invalid';
    END IF;

    SELECT * INTO assignment_record
    FROM submission.assignment_projections
    WHERE tenant_id = p_tenant_id
      AND candidate_assignment_id = p_candidate_assignment_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'candidate assignment was not found' USING ERRCODE = 'P0001';
    END IF;
    IF assignment_record.candidate_id <> actor_id THEN
        RAISE EXCEPTION 'attempt belongs to another candidate' USING ERRCODE = '42501';
    END IF;
    IF assignment_record.lifecycle_state <> 'active'
       OR clock_timestamp() < assignment_record.available_from
       OR clock_timestamp() >= assignment_record.available_until
    THEN
        RAISE EXCEPTION 'candidate assignment is not currently available' USING ERRCODE = '55000';
    END IF;

    SELECT * INTO attempt_record
    FROM submission.attempts
    WHERE tenant_id = p_tenant_id
      AND candidate_assignment_id = p_candidate_assignment_id
      AND start_idempotency_key = p_idempotency_key
    FOR UPDATE;
    IF FOUND THEN
        IF attempt_record.start_request_checksum <> p_request_checksum THEN
            RAISE EXCEPTION 'attempt idempotency key was reused with a different request' USING ERRCODE = '23505';
        END IF;
        RETURN QUERY
        SELECT attempt_record.id, attempt_record.tenant_id, attempt_record.exam_id, attempt_record.exam_version_id,
               attempt_record.candidate_id, attempt_record.candidate_assignment_id, attempt_record.attempt_number,
               attempt_record.lifecycle_state, attempt_record.available_from, attempt_record.submission_deadline,
               attempt_record.started_at, attempt_record.submitted_at, attempt_record.completed_at,
               attempt_record.version, attempt_record.created_at;
        RETURN;
    END IF;

    SELECT count(*) + 1 INTO next_attempt_number
    FROM submission.attempts
    WHERE tenant_id = p_tenant_id
      AND candidate_assignment_id = p_candidate_assignment_id;
    IF next_attempt_number > assignment_record.attempt_limit THEN
        RAISE EXCEPTION 'candidate has exhausted available attempts' USING ERRCODE = '55000';
    END IF;

    INSERT INTO submission.attempts (
        id, tenant_id, exam_id, exam_version_id, candidate_id, candidate_assignment_id,
        attempt_number, lifecycle_state, available_from, started_at, submission_deadline,
        start_idempotency_key, start_request_checksum
    ) VALUES (
        p_attempt_id, p_tenant_id, assignment_record.exam_id, assignment_record.exam_version_id,
        assignment_record.candidate_id, assignment_record.candidate_assignment_id,
        next_attempt_number::smallint, 'active', assignment_record.available_from,
        clock_timestamp(), assignment_record.available_until,
        p_idempotency_key, p_request_checksum
    ) RETURNING * INTO attempt_record;

    INSERT INTO submission.attempt_events (id, tenant_id, attempt_id, actor_id, event_type, payload)
    VALUES (
        p_attempt_event_id, p_tenant_id, p_attempt_id, actor_id, 'submission.attempt.started.v1',
        jsonb_build_object(
            'attempt_id', p_attempt_id,
            'candidate_assignment_id', p_candidate_assignment_id,
            'attempt_number', next_attempt_number
        )
    );

    RETURN QUERY
    SELECT attempt_record.id, attempt_record.tenant_id, attempt_record.exam_id, attempt_record.exam_version_id,
           attempt_record.candidate_id, attempt_record.candidate_assignment_id, attempt_record.attempt_number,
           attempt_record.lifecycle_state, attempt_record.available_from, attempt_record.submission_deadline,
           attempt_record.started_at, attempt_record.submitted_at, attempt_record.completed_at,
           attempt_record.version, attempt_record.created_at;
END
$function$;

CREATE FUNCTION submission.get_attempt_for_candidate(
    p_tenant_id uuid,
    p_attempt_id uuid
)
RETURNS TABLE (
    id uuid,
    tenant_id uuid,
    exam_id uuid,
    exam_version_id uuid,
    candidate_id uuid,
    candidate_assignment_id uuid,
    attempt_number smallint,
    lifecycle_state text,
    available_from timestamptz,
    submission_deadline timestamptz,
    started_at timestamptz,
    submitted_at timestamptz,
    completed_at timestamptz,
    version bigint,
    created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz, submission
AS $function$
DECLARE
    actor_id uuid;
BEGIN
    IF NOT authz.current_context_allows_read(
        p_tenant_id, 'submission.read', 'submission.write', 'submission.attempts'
    ) THEN
        RAISE EXCEPTION 'signed authorization context does not allow this submission operation'
            USING ERRCODE = '42501';
    END IF;
    actor_id := authz.current_context_actor_id();
    IF actor_id IS NULL THEN
        RAISE EXCEPTION 'attempt reader is invalid' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
    SELECT attempt_row.id, attempt_row.tenant_id, attempt_row.exam_id, attempt_row.exam_version_id,
           attempt_row.candidate_id, attempt_row.candidate_assignment_id, attempt_row.attempt_number,
           attempt_row.lifecycle_state, attempt_row.available_from, attempt_row.submission_deadline,
           attempt_row.started_at, attempt_row.submitted_at, attempt_row.completed_at,
           attempt_row.version, attempt_row.created_at
    FROM submission.attempts AS attempt_row
    WHERE attempt_row.tenant_id = p_tenant_id
      AND attempt_row.id = p_attempt_id
      AND attempt_row.candidate_id = actor_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'candidate attempt was not found' USING ERRCODE = 'P0001';
    END IF;
END
$function$;

CREATE FUNCTION submission.count_evaluation_requests_for_candidate(
    p_tenant_id uuid,
    p_attempt_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz, submission
AS $function$
DECLARE
    actor_id uuid;
    request_count integer;
BEGIN
    IF NOT authz.current_context_allows_read(
        p_tenant_id, 'submission.read', 'submission.write', 'submission.attempts'
    ) THEN
        RAISE EXCEPTION 'signed authorization context does not allow this submission operation'
            USING ERRCODE = '42501';
    END IF;
    actor_id := authz.current_context_actor_id();
    IF NOT EXISTS (
        SELECT 1
        FROM submission.attempts AS attempt_row
        WHERE attempt_row.tenant_id = p_tenant_id
          AND attempt_row.id = p_attempt_id
          AND attempt_row.candidate_id = actor_id
    ) THEN
        RAISE EXCEPTION 'candidate attempt was not found' USING ERRCODE = 'P0001';
    END IF;
    SELECT count(*) INTO request_count
    FROM submission.evaluation_requests
    WHERE tenant_id = p_tenant_id AND attempt_id = p_attempt_id;
    RETURN request_count;
END
$function$;

CREATE FUNCTION submission.append_answer_revision(
    p_answer_revision_id uuid,
    p_attempt_event_id uuid,
    p_tenant_id uuid,
    p_attempt_id uuid,
    p_exam_item_id uuid,
    p_language_id text,
    p_source_object_key text,
    p_source_checksum text,
    p_encryption_key_reference text,
    p_expected_attempt_version bigint
)
RETURNS TABLE (
    id uuid,
    tenant_id uuid,
    attempt_id uuid,
    exam_item_id uuid,
    revision_number integer,
    language_id text,
    source_object_key text,
    source_checksum char(64),
    encryption_key_reference text,
    created_at timestamptz,
    created_by uuid,
    attempt_version bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz, submission
AS $function$
DECLARE
    attempt_record submission.attempts%ROWTYPE;
    answer_record submission.answer_revisions%ROWTYPE;
    actor_id uuid;
    next_revision_number integer;
BEGIN
    PERFORM submission.require_authorized_context(p_tenant_id, 'submission.write', 'submission.attempts');
    actor_id := authz.current_context_actor_id();
    IF p_answer_revision_id IS NULL OR p_attempt_event_id IS NULL OR p_attempt_id IS NULL OR p_exam_item_id IS NULL
       OR actor_id IS NULL OR p_expected_attempt_version <= 0 THEN
        RAISE EXCEPTION 'answer revision command is invalid';
    END IF;

    SELECT * INTO attempt_record
    FROM submission.attempts
    WHERE tenant_id = p_tenant_id AND id = p_attempt_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'candidate attempt was not found' USING ERRCODE = 'P0001';
    END IF;
    IF attempt_record.candidate_id <> actor_id THEN
        RAISE EXCEPTION 'attempt belongs to another candidate' USING ERRCODE = '42501';
    END IF;
    IF attempt_record.lifecycle_state <> 'active' OR clock_timestamp() >= attempt_record.submission_deadline THEN
        RAISE EXCEPTION 'attempt is no longer accepting answers' USING ERRCODE = '55000';
    END IF;
    IF attempt_record.version <> p_expected_attempt_version THEN
        RAISE EXCEPTION 'attempt version does not match' USING ERRCODE = '23505';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM submission.assignment_item_projections AS item
        WHERE item.tenant_id = p_tenant_id
          AND item.candidate_assignment_id = attempt_record.candidate_assignment_id
          AND item.exam_item_id = p_exam_item_id
    ) THEN
        RAISE EXCEPTION 'exam item is not assigned to this attempt';
    END IF;

    SELECT COALESCE(max(revision.revision_number), 0) + 1
    INTO next_revision_number
    FROM submission.answer_revisions AS revision
    WHERE revision.tenant_id = p_tenant_id
      AND revision.attempt_id = p_attempt_id
      AND revision.exam_item_id = p_exam_item_id;

    INSERT INTO submission.answer_revisions (
        id, tenant_id, attempt_id, exam_item_id, revision_number, language_id,
        source_object_key, source_checksum, encryption_key_reference, created_by
    ) VALUES (
        p_answer_revision_id, p_tenant_id, p_attempt_id, p_exam_item_id, next_revision_number,
        p_language_id, p_source_object_key, p_source_checksum, p_encryption_key_reference, actor_id
    ) RETURNING * INTO answer_record;

    UPDATE submission.attempts
    SET version = version + 1
    WHERE tenant_id = p_tenant_id AND id = p_attempt_id
    RETURNING * INTO attempt_record;

    INSERT INTO submission.attempt_events (id, tenant_id, attempt_id, actor_id, event_type, payload)
    VALUES (
        p_attempt_event_id, p_tenant_id, p_attempt_id, actor_id, 'submission.answer.revised.v1',
        jsonb_build_object(
            'answer_revision_id', p_answer_revision_id,
            'exam_item_id', p_exam_item_id,
            'revision_number', next_revision_number
        )
    );

    RETURN QUERY
    SELECT answer_record.id, answer_record.tenant_id, answer_record.attempt_id, answer_record.exam_item_id,
           answer_record.revision_number, answer_record.language_id, answer_record.source_object_key,
           answer_record.source_checksum, answer_record.encryption_key_reference,
           answer_record.created_at, answer_record.created_by, attempt_record.version;
END
$function$;

CREATE FUNCTION submission.prepare_submission(
    p_tenant_id uuid,
    p_attempt_id uuid,
    p_expected_attempt_version bigint
)
RETURNS TABLE (
    answer_revision_id uuid,
    exam_item_id uuid,
    evaluation_bundle_object_key text,
    evaluation_bundle_checksum char(64),
    maximum_score numeric(12,4)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz, submission
AS $function$
DECLARE
    attempt_record submission.attempts%ROWTYPE;
    actor_id uuid;
BEGIN
    PERFORM submission.require_authorized_context(p_tenant_id, 'submission.write', 'submission.attempts');
    actor_id := authz.current_context_actor_id();
    SELECT * INTO attempt_record
    FROM submission.attempts
    WHERE tenant_id = p_tenant_id AND id = p_attempt_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'candidate attempt was not found' USING ERRCODE = 'P0001';
    END IF;
    IF actor_id IS NULL OR attempt_record.candidate_id <> actor_id THEN
        RAISE EXCEPTION 'attempt belongs to another candidate' USING ERRCODE = '42501';
    END IF;
    IF attempt_record.lifecycle_state <> 'active' OR clock_timestamp() >= attempt_record.submission_deadline THEN
        RAISE EXCEPTION 'attempt is no longer submittable' USING ERRCODE = '55000';
    END IF;
    IF p_expected_attempt_version <= 0 OR attempt_record.version <> p_expected_attempt_version THEN
        RAISE EXCEPTION 'attempt version does not match' USING ERRCODE = '23505';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM submission.answer_revisions AS revision
        WHERE revision.tenant_id = p_tenant_id AND revision.attempt_id = p_attempt_id
    ) THEN
        RAISE EXCEPTION 'attempt has no answer revisions';
    END IF;

    RETURN QUERY
    SELECT latest_revision.id,
           latest_revision.exam_item_id,
           item.evaluation_bundle_object_key,
           item.evaluation_bundle_checksum,
           item.maximum_score
    FROM (
        SELECT DISTINCT ON (revision.exam_item_id)
               revision.id, revision.exam_item_id, revision.revision_number
        FROM submission.answer_revisions AS revision
        WHERE revision.tenant_id = p_tenant_id
          AND revision.attempt_id = p_attempt_id
        ORDER BY revision.exam_item_id, revision.revision_number DESC
    ) AS latest_revision
    JOIN submission.assignment_item_projections AS item
      ON item.tenant_id = p_tenant_id
     AND item.candidate_assignment_id = attempt_record.candidate_assignment_id
     AND item.exam_item_id = latest_revision.exam_item_id;
END
$function$;

CREATE FUNCTION submission.submit_attempt(
    p_submitted_event_id uuid,
    p_grading_event_id uuid,
    p_tenant_id uuid,
    p_attempt_id uuid,
    p_expected_attempt_version bigint,
    p_idempotency_key text,
    p_request_checksum text,
    p_evaluation_requests jsonb
)
RETURNS TABLE (
    id uuid,
    tenant_id uuid,
    exam_id uuid,
    exam_version_id uuid,
    candidate_id uuid,
    candidate_assignment_id uuid,
    attempt_number smallint,
    lifecycle_state text,
    available_from timestamptz,
    submission_deadline timestamptz,
    started_at timestamptz,
    submitted_at timestamptz,
    completed_at timestamptz,
    version bigint,
    created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz, submission
AS $function$
DECLARE
    attempt_record submission.attempts%ROWTYPE;
    actor_id uuid;
    request_count integer;
    distinct_revision_count integer;
    distinct_request_count integer;
    expected_count integer;
BEGIN
    PERFORM submission.require_authorized_context(p_tenant_id, 'submission.write', 'submission.attempts');
    actor_id := authz.current_context_actor_id();
    IF p_submitted_event_id IS NULL OR p_grading_event_id IS NULL OR p_attempt_id IS NULL
       OR actor_id IS NULL OR p_expected_attempt_version <= 0
       OR length(btrim(p_idempotency_key)) NOT BETWEEN 1 AND 255
       OR p_request_checksum !~* '^[0-9a-f]{64}$'
       OR jsonb_typeof(p_evaluation_requests) <> 'array'
    THEN
        RAISE EXCEPTION 'attempt submission command is invalid';
    END IF;

    SELECT * INTO attempt_record
    FROM submission.attempts
    WHERE tenant_id = p_tenant_id AND id = p_attempt_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'candidate attempt was not found' USING ERRCODE = 'P0001';
    END IF;
    IF attempt_record.candidate_id <> actor_id THEN
        RAISE EXCEPTION 'attempt belongs to another candidate' USING ERRCODE = '42501';
    END IF;
    IF attempt_record.submit_idempotency_key IS NOT NULL THEN
        IF attempt_record.submit_idempotency_key <> p_idempotency_key
           OR attempt_record.submit_request_checksum <> p_request_checksum THEN
            RAISE EXCEPTION 'attempt idempotency key was reused with a different request' USING ERRCODE = '23505';
        END IF;
        RETURN QUERY
        SELECT attempt_record.id, attempt_record.tenant_id, attempt_record.exam_id, attempt_record.exam_version_id,
               attempt_record.candidate_id, attempt_record.candidate_assignment_id, attempt_record.attempt_number,
               attempt_record.lifecycle_state, attempt_record.available_from, attempt_record.submission_deadline,
               attempt_record.started_at, attempt_record.submitted_at, attempt_record.completed_at,
               attempt_record.version, attempt_record.created_at;
        RETURN;
    END IF;
    IF attempt_record.lifecycle_state <> 'active' OR clock_timestamp() >= attempt_record.submission_deadline THEN
        RAISE EXCEPTION 'attempt is no longer submittable' USING ERRCODE = '55000';
    END IF;
    IF attempt_record.version <> p_expected_attempt_version THEN
        RAISE EXCEPTION 'attempt version does not match' USING ERRCODE = '23505';
    END IF;
    IF jsonb_array_length(p_evaluation_requests) = 0 THEN
        RAISE EXCEPTION 'attempt submission command is invalid';
    END IF;

    WITH requested AS (
        SELECT *
        FROM jsonb_to_recordset(p_evaluation_requests) AS request_row(
            id uuid,
            answer_revision_id uuid,
            exam_item_id uuid,
            evaluation_bundle_object_key text,
            evaluation_bundle_checksum char(64),
            maximum_score numeric(12,4),
            caller_idempotency_key text
        )
    )
    SELECT count(*), count(DISTINCT answer_revision_id), count(DISTINCT id)
    INTO request_count, distinct_revision_count, distinct_request_count
    FROM requested;
    IF request_count <> distinct_revision_count OR request_count <> distinct_request_count THEN
        RAISE EXCEPTION 'evaluation request IDs and answer revisions must be unique';
    END IF;

    SELECT count(*) INTO expected_count
    FROM (
        SELECT DISTINCT ON (revision.exam_item_id) revision.id
        FROM submission.answer_revisions AS revision
        WHERE revision.tenant_id = p_tenant_id
          AND revision.attempt_id = p_attempt_id
        ORDER BY revision.exam_item_id, revision.revision_number DESC
    ) AS latest_revision;
    IF request_count <> expected_count OR expected_count = 0 THEN
        RAISE EXCEPTION 'evaluation requests do not cover the current answer set';
    END IF;

    IF EXISTS (
        WITH requested AS (
            SELECT *
            FROM jsonb_to_recordset(p_evaluation_requests) AS request_row(
                id uuid,
                answer_revision_id uuid,
                exam_item_id uuid,
                evaluation_bundle_object_key text,
                evaluation_bundle_checksum char(64),
                maximum_score numeric(12,4),
                caller_idempotency_key text
            )
        ), latest AS (
            SELECT DISTINCT ON (revision.exam_item_id)
                   revision.id AS answer_revision_id,
                   revision.exam_item_id,
                   item.evaluation_bundle_object_key,
                   item.evaluation_bundle_checksum,
                   item.maximum_score
            FROM submission.answer_revisions AS revision
            JOIN submission.assignment_item_projections AS item
              ON item.tenant_id = revision.tenant_id
             AND item.candidate_assignment_id = attempt_record.candidate_assignment_id
             AND item.exam_item_id = revision.exam_item_id
            WHERE revision.tenant_id = p_tenant_id
              AND revision.attempt_id = p_attempt_id
            ORDER BY revision.exam_item_id, revision.revision_number DESC
        )
        SELECT 1
        FROM requested
        FULL OUTER JOIN latest USING (answer_revision_id)
        WHERE requested.id IS NULL
           OR latest.answer_revision_id IS NULL
           OR requested.exam_item_id IS DISTINCT FROM latest.exam_item_id
           OR requested.evaluation_bundle_object_key IS DISTINCT FROM latest.evaluation_bundle_object_key
           OR requested.evaluation_bundle_checksum IS DISTINCT FROM latest.evaluation_bundle_checksum
           OR requested.maximum_score IS DISTINCT FROM latest.maximum_score
           OR length(btrim(requested.caller_idempotency_key)) NOT BETWEEN 1 AND 255
    ) THEN
        RAISE EXCEPTION 'evaluation requests are not an immutable snapshot of the current answers';
    END IF;

    INSERT INTO submission.evaluation_requests (
        id, tenant_id, attempt_id, answer_revision_id,
        evaluation_bundle_object_key, evaluation_bundle_checksum,
        caller_idempotency_key, maximum_score
    )
    SELECT
        request_row.id, p_tenant_id, p_attempt_id, request_row.answer_revision_id,
        request_row.evaluation_bundle_object_key, request_row.evaluation_bundle_checksum,
        request_row.caller_idempotency_key, request_row.maximum_score
    FROM jsonb_to_recordset(p_evaluation_requests) AS request_row(
        id uuid,
        answer_revision_id uuid,
        exam_item_id uuid,
        evaluation_bundle_object_key text,
        evaluation_bundle_checksum char(64),
        maximum_score numeric(12,4),
        caller_idempotency_key text
    );

    UPDATE submission.attempts
    SET lifecycle_state = 'grading',
        submitted_at = clock_timestamp(),
        submit_idempotency_key = p_idempotency_key,
        submit_request_checksum = p_request_checksum,
        version = version + 1
    WHERE tenant_id = p_tenant_id AND id = p_attempt_id
    RETURNING * INTO attempt_record;

    INSERT INTO submission.attempt_events (id, tenant_id, attempt_id, actor_id, event_type, payload)
    VALUES
        (
            p_submitted_event_id, p_tenant_id, p_attempt_id, actor_id, 'submission.attempt.submitted.v1',
            jsonb_build_object('attempt_id', p_attempt_id, 'evaluation_request_count', request_count)
        ),
        (
            p_grading_event_id, p_tenant_id, p_attempt_id, actor_id, 'submission.attempt.grading.v1',
            jsonb_build_object('attempt_id', p_attempt_id, 'evaluation_request_count', request_count)
        );

    RETURN QUERY
    SELECT attempt_record.id, attempt_record.tenant_id, attempt_record.exam_id, attempt_record.exam_version_id,
           attempt_record.candidate_id, attempt_record.candidate_assignment_id, attempt_record.attempt_number,
           attempt_record.lifecycle_state, attempt_record.available_from, attempt_record.submission_deadline,
           attempt_record.started_at, attempt_record.submitted_at, attempt_record.completed_at,
           attempt_record.version, attempt_record.created_at;
END
$function$;

CREATE FUNCTION submission.record_judge_completion(
    p_receipt_id uuid,
    p_attempt_event_id uuid,
    p_score_summary_id uuid,
    p_outbox_event_id uuid,
    p_tenant_id uuid,
    p_evaluation_request_id uuid,
    p_judge_job_id uuid,
    p_judge_event_id uuid,
    p_verdict text,
    p_execution_time_ms integer,
    p_memory_kib integer,
    p_result_object_key text,
    p_result_checksum text,
    p_encryption_key_reference text,
    p_received_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, submission, extensions
AS $function$
DECLARE
    request_record submission.evaluation_requests%ROWTYPE;
    attempt_record submission.attempts%ROWTYPE;
    final_score numeric(12,4);
    final_maximum_score numeric(12,4);
    event_payload jsonb;
BEGIN
    IF p_receipt_id IS NULL OR p_attempt_event_id IS NULL OR p_score_summary_id IS NULL
       OR p_outbox_event_id IS NULL OR p_tenant_id IS NULL OR p_evaluation_request_id IS NULL
       OR p_judge_job_id IS NULL OR p_judge_event_id IS NULL OR p_received_at IS NULL
       OR p_verdict NOT IN (
            'accepted', 'wrong_answer', 'time_limit_exceeded', 'memory_limit_exceeded',
            'runtime_error', 'compile_error', 'internal_error', 'cancelled'
       )
       OR (p_execution_time_ms IS NOT NULL AND p_execution_time_ms < 0)
       OR (p_memory_kib IS NOT NULL AND p_memory_kib < 0)
       OR ((p_result_object_key IS NULL) <> (p_result_checksum IS NULL))
       OR ((p_result_object_key IS NULL) <> (p_encryption_key_reference IS NULL))
    THEN
        RAISE EXCEPTION 'judge completion payload is invalid';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM submission.judge_receipts AS receipt
        WHERE receipt.tenant_id = p_tenant_id
          AND receipt.judge_event_id = p_judge_event_id
    ) THEN
        RETURN false;
    END IF;

    SELECT * INTO request_record
    FROM submission.evaluation_requests
    WHERE tenant_id = p_tenant_id AND id = p_evaluation_request_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'evaluation request was not found' USING ERRCODE = 'P0001';
    END IF;
    IF request_record.judge_job_id IS NOT NULL AND request_record.judge_job_id <> p_judge_job_id THEN
        RAISE EXCEPTION 'judge completion does not match the dispatched job';
    END IF;

    INSERT INTO submission.judge_receipts (
        id, tenant_id, evaluation_request_id, judge_job_id, judge_event_id, verdict,
        execution_time_ms, memory_kib, result_object_key, result_checksum,
        encryption_key_reference, received_at
    ) VALUES (
        p_receipt_id, p_tenant_id, p_evaluation_request_id, p_judge_job_id, p_judge_event_id, p_verdict,
        p_execution_time_ms, p_memory_kib, p_result_object_key, p_result_checksum,
        p_encryption_key_reference, p_received_at
    );

    IF request_record.lifecycle_state = 'cancelled' THEN
        RETURN false;
    END IF;

    UPDATE submission.evaluation_requests
    SET judge_job_id = p_judge_job_id,
        lifecycle_state = 'completed',
        dispatched_at = COALESCE(dispatched_at, p_received_at),
        completed_at = p_received_at,
        version = version + 1
    WHERE tenant_id = p_tenant_id AND id = p_evaluation_request_id;

    SELECT * INTO attempt_record
    FROM submission.attempts
    WHERE tenant_id = p_tenant_id AND id = request_record.attempt_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'evaluation request has no attempt' USING ERRCODE = 'P0001';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM submission.evaluation_requests AS request_row
        WHERE request_row.tenant_id = p_tenant_id
          AND request_row.attempt_id = attempt_record.id
          AND request_row.lifecycle_state IN ('queued', 'dispatched')
    ) THEN
        RETURN false;
    END IF;

    SELECT
        COALESCE(sum(CASE WHEN receipt.verdict = 'accepted' THEN request_row.maximum_score ELSE 0 END), 0),
        COALESCE(sum(request_row.maximum_score), 0)
    INTO final_score, final_maximum_score
    FROM submission.evaluation_requests AS request_row
    LEFT JOIN submission.judge_receipts AS receipt
      ON receipt.tenant_id = request_row.tenant_id
     AND receipt.evaluation_request_id = request_row.id
    WHERE request_row.tenant_id = p_tenant_id
      AND request_row.attempt_id = attempt_record.id;

    UPDATE submission.attempts
    SET lifecycle_state = 'graded',
        completed_at = COALESCE(completed_at, clock_timestamp()),
        version = version + 1
    WHERE tenant_id = p_tenant_id AND id = attempt_record.id
    RETURNING * INTO attempt_record;

    INSERT INTO submission.score_summaries (
        id, tenant_id, attempt_id, score, maximum_score,
        lifecycle_state, calculation_version, finalized_at
    ) VALUES (
        p_score_summary_id, p_tenant_id, attempt_record.id, final_score, final_maximum_score,
        'finalized', 1, clock_timestamp()
    )
    ON CONFLICT (tenant_id, attempt_id) DO UPDATE
    SET score = EXCLUDED.score,
        maximum_score = EXCLUDED.maximum_score,
        lifecycle_state = 'finalized',
        calculation_version = submission.score_summaries.calculation_version + 1,
        calculated_at = clock_timestamp(),
        finalized_at = clock_timestamp(),
        version = submission.score_summaries.version + 1;

    INSERT INTO submission.attempt_events (id, tenant_id, attempt_id, event_type, payload)
    VALUES (
        p_attempt_event_id, p_tenant_id, attempt_record.id, 'submission.attempt.graded.v1',
        jsonb_build_object(
            'attempt_id', attempt_record.id,
            'score', final_score,
            'maximum_score', final_maximum_score
        )
    );

    event_payload := jsonb_build_object(
        'attempt_id', attempt_record.id,
        'score', final_score,
        'maximum_score', final_maximum_score,
        'completed_at', attempt_record.completed_at
    );
    INSERT INTO app.outbox_events (
        event_id, aggregate_type, aggregate_id, tenant_id, event_type,
        schema_version, payload, payload_sha256, occurred_at
    ) VALUES (
        p_outbox_event_id, 'attempt', attempt_record.id, p_tenant_id, 'submission.attempt_graded.v1',
        1, event_payload,
        extensions.digest(convert_to(event_payload::text, 'UTF8'), 'sha256'), clock_timestamp()
    );

    RETURN true;
END
$function$;

REVOKE ALL ON TABLE
    submission.attempts,
    submission.answer_revisions,
    submission.evaluation_requests,
    submission.judge_receipts,
    submission.score_summaries,
    submission.attempt_events
FROM aether_submission_app;
REVOKE ALL ON TABLE app.inbox_messages FROM aether_submission_app;
REVOKE ALL ON TABLE app.outbox_events FROM aether_submission_app;
GRANT SELECT, INSERT, UPDATE ON TABLE app.outbox_events TO aether_submission_app;

GRANT USAGE ON SCHEMA app, submission TO aether_submission_projection_worker;
GRANT SELECT, INSERT, UPDATE ON TABLE app.inbox_messages TO aether_submission_projection_worker;

REVOKE ALL ON FUNCTION submission.require_authorized_context(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION submission.apply_assignment_snapshot(
    uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, timestamptz, smallint, text, bigint, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION submission.start_attempt(uuid, uuid, uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION submission.get_attempt_for_candidate(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION submission.count_evaluation_requests_for_candidate(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION submission.append_answer_revision(
    uuid, uuid, uuid, uuid, uuid, text, text, text, text, bigint
) FROM PUBLIC;
REVOKE ALL ON FUNCTION submission.prepare_submission(uuid, uuid, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION submission.submit_attempt(
    uuid, uuid, uuid, uuid, bigint, text, text, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION submission.record_judge_completion(
    uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, integer, integer, text, text, text, timestamptz
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION submission.start_attempt(uuid, uuid, uuid, uuid, text, text)
    TO aether_submission_app;
GRANT EXECUTE ON FUNCTION submission.get_attempt_for_candidate(uuid, uuid)
    TO aether_submission_app;
GRANT EXECUTE ON FUNCTION submission.count_evaluation_requests_for_candidate(uuid, uuid)
    TO aether_submission_app;
GRANT EXECUTE ON FUNCTION submission.append_answer_revision(
    uuid, uuid, uuid, uuid, uuid, text, text, text, text, bigint
) TO aether_submission_app;
GRANT EXECUTE ON FUNCTION submission.prepare_submission(uuid, uuid, bigint)
    TO aether_submission_app;
GRANT EXECUTE ON FUNCTION submission.submit_attempt(
    uuid, uuid, uuid, uuid, bigint, text, text, jsonb
) TO aether_submission_app;
GRANT EXECUTE ON FUNCTION submission.apply_assignment_snapshot(
    uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, timestamptz, smallint, text, bigint, jsonb
) TO aether_submission_projection_worker;
GRANT EXECUTE ON FUNCTION submission.record_judge_completion(
    uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, integer, integer, text, text, text, timestamptz
) TO aether_submission_projection_worker;

RESET ROLE;
