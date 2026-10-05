-- Time limits and time-up, as the exam app this replaces has them.
--
-- An attempt's deadline is the earlier of its start plus the exam's duration
-- and the assignment window's close. Until now it was always the window's
-- close, so a 60-minute exam in a two-hour window gave two hours. The
-- duration arrives on the assignment snapshot (Assessment migration 000025);
-- assignments projected before that carry none and keep the window's close.
--
-- Answers and submissions are accepted for answer_grace() (15 s) after the
-- deadline, so the last save a browser sends as time runs out still lands.
--
-- When that grace has passed, the expiry worker submits the latest answer for
-- every item exactly as a candidate's own submit would: one queued evaluation
-- request per item, the attempt moved to grading, and the same
-- attempt_submitted and evaluation_requested events. An attempt with no
-- answer at all is still marked expired.
SET ROLE aether_submission_owner;

ALTER TABLE submission.assignment_projections
    ADD COLUMN duration_seconds integer CHECK (duration_seconds BETWEEN 60 AND 43200);

CREATE FUNCTION submission.answer_grace()
RETURNS interval
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $function$ SELECT interval '15 seconds' $function$;

CREATE OR REPLACE FUNCTION submission.start_attempt(
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
#variable_conflict use_column
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
        clock_timestamp(),
        CASE WHEN assignment_record.duration_seconds IS NULL THEN assignment_record.available_until
             ELSE LEAST(assignment_record.available_until,
                        clock_timestamp() + make_interval(secs => assignment_record.duration_seconds))
        END,
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

CREATE OR REPLACE FUNCTION submission.append_answer_revision(
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
#variable_conflict use_column
DECLARE
    attempt_record submission.attempts%ROWTYPE;
    answer_record submission.answer_revisions%ROWTYPE;
    actor_id uuid;
    next_revision_number integer;
    item_languages text[];
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
    IF attempt_record.lifecycle_state <> 'active' OR clock_timestamp() >= attempt_record.submission_deadline + submission.answer_grace() THEN
        RAISE EXCEPTION 'attempt is no longer accepting answers' USING ERRCODE = '55000';
    END IF;
    IF attempt_record.version <> p_expected_attempt_version THEN
        RAISE EXCEPTION 'attempt version does not match' USING ERRCODE = '23505';
    END IF;
    SELECT item.supported_languages INTO item_languages
    FROM submission.assignment_item_projections AS item
    WHERE item.tenant_id = p_tenant_id
      AND item.candidate_assignment_id = attempt_record.candidate_assignment_id
      AND item.exam_item_id = p_exam_item_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'exam item is not assigned to this attempt';
    END IF;
    -- An item pinned before Assessment migration 000024 has no languages and
    -- cannot be graded, so it accepts no answer either.
    IF item_languages IS NULL OR NOT (p_language_id = ANY (item_languages)) THEN
        RAISE EXCEPTION 'language is not supported by this exam item' USING ERRCODE = '22023';
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

CREATE OR REPLACE FUNCTION submission.prepare_submission(
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
#variable_conflict use_column
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
    IF attempt_record.lifecycle_state <> 'active' OR clock_timestamp() >= attempt_record.submission_deadline + submission.answer_grace() THEN
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

CREATE OR REPLACE FUNCTION submission.submit_attempt(
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
#variable_conflict use_column
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
    IF attempt_record.lifecycle_state <> 'active' OR clock_timestamp() >= attempt_record.submission_deadline + submission.answer_grace() THEN
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

DROP FUNCTION submission.apply_assignment_snapshot(uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, timestamptz, smallint, text, bigint, jsonb);

CREATE OR REPLACE FUNCTION submission.apply_assignment_snapshot(
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
    p_items jsonb,
    p_duration_seconds integer
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
    cancelled_attempt submission.attempts%ROWTYPE;
    cancellation_payload jsonb;
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
       OR p_duration_seconds NOT BETWEEN 60 AND 43200
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
        available_from, available_until, attempt_limit, lifecycle_state, version, source_event_id,
        duration_seconds
    ) VALUES (
        p_tenant_id, p_candidate_assignment_id, p_candidate_id, p_exam_id, p_exam_version_id,
        p_available_from, p_available_until, p_attempt_limit, p_lifecycle_state, p_version, p_source_event_id,
        p_duration_seconds
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
        duration_seconds = EXCLUDED.duration_seconds,
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
        evaluation_bundle_object_key, evaluation_bundle_checksum, maximum_score,
        evaluation_bundle_key_reference, sample_bundle_object_key, sample_bundle_checksum,
        sample_bundle_key_reference, time_limit_ms, memory_limit_kib, supported_languages
    )
    SELECT
        p_tenant_id,
        p_candidate_assignment_id,
        (item ->> 'exam_item_id')::uuid,
        item ->> 'evaluation_bundle_object_key',
        item ->> 'evaluation_bundle_checksum',
        (item ->> 'maximum_score')::numeric(12,4),
        NULLIF(item ->> 'evaluation_bundle_key_reference', ''),
        NULLIF(item ->> 'sample_bundle_object_key', ''),
        NULLIF(item ->> 'sample_bundle_checksum', ''),
        NULLIF(item ->> 'sample_bundle_key_reference', ''),
        (item ->> 'time_limit_ms')::integer,
        (item ->> 'memory_limit_kib')::integer,
        CASE WHEN jsonb_typeof(item -> 'supported_languages') = 'array'
             THEN ARRAY(SELECT jsonb_array_elements_text(item -> 'supported_languages'))
        END
    FROM jsonb_array_elements(p_items) AS item;

    IF p_lifecycle_state <> 'revoked' THEN
        RETURN true;
    END IF;

    -- Lock and cancel every nonterminal attempt before cancelling its queued
    -- Judge work.  The source-event/version gate above makes replay harmless.
    FOR cancelled_attempt IN
        UPDATE submission.attempts AS attempt_row
        SET lifecycle_state = 'cancelled',
            completed_at = COALESCE(attempt_row.completed_at, clock_timestamp()),
            version = attempt_row.version + 1
        WHERE attempt_row.tenant_id = p_tenant_id
          AND attempt_row.candidate_assignment_id = p_candidate_assignment_id
          AND attempt_row.lifecycle_state IN ('created', 'active', 'submitted', 'grading')
        RETURNING attempt_row.*
    LOOP
        UPDATE submission.evaluation_requests AS request_row
        SET lifecycle_state = 'cancelled',
            completed_at = COALESCE(request_row.completed_at, clock_timestamp()),
            failure_code = 'assessment_assignment_revoked',
            version = request_row.version + 1
        WHERE request_row.tenant_id = p_tenant_id
          AND request_row.attempt_id = cancelled_attempt.id
          AND request_row.lifecycle_state IN ('queued', 'dispatched');

        cancellation_payload := jsonb_build_object(
            'attempt_id', cancelled_attempt.id,
            'tenant_id', cancelled_attempt.tenant_id,
            'candidate_assignment_id', cancelled_attempt.candidate_assignment_id,
            'candidate_id', cancelled_attempt.candidate_id,
            'exam_id', cancelled_attempt.exam_id,
            'exam_version_id', cancelled_attempt.exam_version_id,
            'attempt_number', cancelled_attempt.attempt_number,
            'lifecycle_state', cancelled_attempt.lifecycle_state,
            'cancellation_reason', 'assessment_assignment_revoked',
            'assessment_snapshot_event_id', p_source_event_id,
            'cancelled_at', cancelled_attempt.completed_at
        );

        INSERT INTO submission.attempt_events (id, tenant_id, attempt_id, event_type, payload)
        VALUES (
            extensions.gen_random_uuid(), p_tenant_id, cancelled_attempt.id,
            'submission.attempt.cancelled.v1', cancellation_payload
        );

        INSERT INTO app.outbox_events (
            event_id, aggregate_type, aggregate_id, tenant_id, event_type,
            schema_version, payload, payload_sha256, occurred_at
        ) VALUES (
            extensions.gen_random_uuid(), 'attempt', cancelled_attempt.id, p_tenant_id,
            'submission.attempt_cancelled.v1', 1, cancellation_payload,
            extensions.digest(convert_to(cancellation_payload::text, 'UTF8'), 'sha256'), clock_timestamp()
        );
    END LOOP;

    RETURN true;
END
$function$;

REVOKE ALL ON FUNCTION submission.apply_assignment_snapshot(uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, timestamptz, smallint, text, bigint, jsonb, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submission.apply_assignment_snapshot(uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, timestamptz, smallint, text, bigint, jsonb, integer)
    TO aether_submission_projection_worker;

CREATE OR REPLACE FUNCTION submission.expire_overdue_attempts(p_limit integer DEFAULT 500)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, submission, app
AS $function$
DECLARE
    expired_count integer := 0;
    attempt_row   submission.attempts%ROWTYPE;
    request_count integer;
    event_payload jsonb;
BEGIN
    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 5000 THEN
        RAISE EXCEPTION 'expiry batch limit must be between 1 and 5000' USING ERRCODE = '22023';
    END IF;

    FOR attempt_row IN
        SELECT *
        FROM submission.attempts
        WHERE lifecycle_state IN ('created', 'active')
          AND submission_deadline + submission.answer_grace() < clock_timestamp()
          AND deleted_at IS NULL
        ORDER BY submission_deadline
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    LOOP
        -- The latest revision of every answered item becomes a queued
        -- evaluation request, as submit_attempt records it, and is announced
        -- with the payload the service writes for a candidate's own submit.
        WITH latest AS (
            SELECT DISTINCT ON (revision.exam_item_id) revision.id, revision.exam_item_id
            FROM submission.answer_revisions AS revision
            WHERE revision.tenant_id = attempt_row.tenant_id
              AND revision.attempt_id = attempt_row.id
            ORDER BY revision.exam_item_id, revision.revision_number DESC
        ), inserted AS (
            INSERT INTO submission.evaluation_requests (
                id, tenant_id, attempt_id, answer_revision_id,
                evaluation_bundle_object_key, evaluation_bundle_checksum,
                caller_idempotency_key, maximum_score
            )
            SELECT extensions.gen_random_uuid(), attempt_row.tenant_id, attempt_row.id, latest.id,
                   item.evaluation_bundle_object_key, item.evaluation_bundle_checksum,
                   'time-up:' || latest.id::text, item.maximum_score
            FROM latest
            JOIN submission.assignment_item_projections AS item
              ON item.tenant_id = attempt_row.tenant_id
             AND item.candidate_assignment_id = attempt_row.candidate_assignment_id
             AND item.exam_item_id = latest.exam_item_id
            RETURNING id, answer_revision_id, evaluation_bundle_object_key, evaluation_bundle_checksum,
                      caller_idempotency_key, maximum_score
        ), announced AS (
            SELECT inserted.id, jsonb_build_object(
                'evaluation_request_id', inserted.id,
                'attempt_id', attempt_row.id,
                'answer_revision_id', inserted.answer_revision_id,
                'exam_item_id', latest.exam_item_id,
                'evaluation_bundle_object_key', inserted.evaluation_bundle_object_key,
                'evaluation_bundle_checksum', inserted.evaluation_bundle_checksum,
                'maximum_score', inserted.maximum_score,
                'caller_idempotency_key', inserted.caller_idempotency_key
            ) AS payload
            FROM inserted
            JOIN latest ON latest.id = inserted.answer_revision_id
        )
        INSERT INTO app.outbox_events (
            event_id, aggregate_type, aggregate_id, tenant_id, event_type,
            schema_version, payload, payload_sha256, occurred_at
        )
        SELECT extensions.gen_random_uuid(), 'evaluation_request', announced.id, attempt_row.tenant_id,
               'submission.evaluation_requested.v1', 1, announced.payload,
               extensions.digest(convert_to(announced.payload::text, 'UTF8'), 'sha256'), clock_timestamp()
        FROM announced;
        GET DIAGNOSTICS request_count = ROW_COUNT;

        IF request_count = 0 THEN
            UPDATE submission.attempts
            SET lifecycle_state = 'expired',
                completed_at    = COALESCE(completed_at, CURRENT_TIMESTAMP),
                version         = version + 1
            WHERE id = attempt_row.id;

            event_payload := jsonb_build_object(
                'attempt_id',      attempt_row.id,
                'tenant_id',       attempt_row.tenant_id,
                'exam_id',         attempt_row.exam_id,
                'exam_version_id', attempt_row.exam_version_id,
                'candidate_id',    attempt_row.candidate_id,
                'expired_at',      CURRENT_TIMESTAMP
            );
            INSERT INTO app.outbox_events (
                event_id, aggregate_type, aggregate_id, tenant_id, event_type,
                schema_version, payload, payload_sha256, occurred_at
            ) VALUES (
                extensions.gen_random_uuid(), 'attempt', attempt_row.id, attempt_row.tenant_id,
                'submission.attempt_expired.v1', 1, event_payload,
                extensions.digest(convert_to(event_payload::text, 'UTF8'), 'sha256'), CURRENT_TIMESTAMP
            );
        ELSE
            UPDATE submission.attempts
            SET lifecycle_state = 'grading',
                submitted_at    = clock_timestamp(),
                version         = version + 1
            WHERE id = attempt_row.id
            RETURNING * INTO attempt_row;

            INSERT INTO submission.attempt_events (id, tenant_id, attempt_id, event_type, payload)
            VALUES
                (extensions.gen_random_uuid(), attempt_row.tenant_id, attempt_row.id, 'submission.attempt.submitted.v1',
                 jsonb_build_object('attempt_id', attempt_row.id, 'evaluation_request_count', request_count, 'reason', 'time_up')),
                (extensions.gen_random_uuid(), attempt_row.tenant_id, attempt_row.id, 'submission.attempt.grading.v1',
                 jsonb_build_object('attempt_id', attempt_row.id, 'evaluation_request_count', request_count));

            event_payload := jsonb_build_object(
                'tenant_id', attempt_row.tenant_id,
                'attempt_id', attempt_row.id,
                'candidate_assignment_id', attempt_row.candidate_assignment_id,
                'candidate_id', attempt_row.candidate_id,
                'exam_id', attempt_row.exam_id,
                'exam_version_id', attempt_row.exam_version_id,
                'evaluation_request_count', request_count,
                'submitted_at', attempt_row.submitted_at
            );
            INSERT INTO app.outbox_events (
                event_id, aggregate_type, aggregate_id, tenant_id, event_type,
                schema_version, payload, payload_sha256, occurred_at
            ) VALUES (
                extensions.gen_random_uuid(), 'attempt', attempt_row.id, attempt_row.tenant_id,
                'submission.attempt_submitted.v1', 1, event_payload,
                extensions.digest(convert_to(event_payload::text, 'UTF8'), 'sha256'), attempt_row.submitted_at
            );
        END IF;

        expired_count := expired_count + 1;
    END LOOP;

    RETURN expired_count;
END
$function$;

RESET ROLE;
