-- Multiple-choice answers and grading (ADR-0035).
-- * Item projections carry an item's kind, options, answer key and whether
--   several options may be chosen; a multiple-choice item has no bundles.
-- * A candidate's selection is stored as is (choice_answers), saved while the
--   attempt is open; code cannot be saved to a multiple-choice item.
-- * The paper shows each candidate the options in an order of its own, with
--   their authored indexes, and never the key.
-- * An item's selection scores its maximum when it equals the key, else 0.
-- * The attempt's maximum is every item the candidate was given. It used to be
--   only the answered ones, so a skipped question raised the percentage.
SET ROLE aether_submission_owner;

ALTER TABLE submission.assignment_item_projections
    ALTER COLUMN evaluation_bundle_object_key DROP NOT NULL,
    ALTER COLUMN evaluation_bundle_checksum DROP NOT NULL,
    ADD COLUMN kind text NOT NULL DEFAULT 'coding' CHECK (kind IN ('coding', 'mcq')),
    ADD COLUMN choices jsonb CHECK (choices IS NULL OR (jsonb_typeof(choices) = 'array' AND jsonb_array_length(choices) BETWEEN 2 AND 10)),
    ADD COLUMN correct_choices integer[],
    ADD COLUMN multiple_choice boolean NOT NULL DEFAULT false,
    ADD CONSTRAINT assignment_item_projections_kind_complete CHECK (
        (kind = 'coding' AND evaluation_bundle_object_key IS NOT NULL AND evaluation_bundle_checksum IS NOT NULL)
        OR (kind = 'mcq' AND choices IS NOT NULL AND cardinality(correct_choices) >= 1)
    );

CREATE TABLE submission.choice_answers (
    tenant_id uuid NOT NULL,
    attempt_id uuid NOT NULL,
    exam_item_id uuid NOT NULL,
    selected integer[] NOT NULL CHECK (cardinality(selected) <= 10),
    revision_number integer NOT NULL DEFAULT 1 CHECK (revision_number > 0),
    saved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (tenant_id, attempt_id, exam_item_id),
    FOREIGN KEY (tenant_id, attempt_id) REFERENCES submission.attempts (tenant_id, id) ON DELETE RESTRICT
);
ALTER TABLE submission.choice_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission.choice_answers FORCE ROW LEVEL SECURITY;
CREATE POLICY submission_choice_answers_owner_maintenance ON submission.choice_answers
    FOR ALL TO aether_submission_owner USING (true) WITH CHECK (true);

-- Code is never saved to a multiple-choice item.
CREATE FUNCTION submission.reject_code_for_choice_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, submission
AS $function$
BEGIN
    IF EXISTS (
        SELECT 1 FROM submission.attempts AS attempt
        JOIN submission.assignment_item_projections AS item
          ON item.tenant_id = attempt.tenant_id AND item.candidate_assignment_id = attempt.candidate_assignment_id
        WHERE attempt.tenant_id = NEW.tenant_id AND attempt.id = NEW.attempt_id
          AND item.exam_item_id = NEW.exam_item_id AND item.kind = 'mcq'
    ) THEN
        RAISE EXCEPTION 'this question is answered by choosing an option' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END
$function$;
CREATE TRIGGER answer_revisions_reject_choice_items
    BEFORE INSERT ON submission.answer_revisions
    FOR EACH ROW EXECUTE FUNCTION submission.reject_code_for_choice_item();

-- Saves a candidate's selection for one multiple-choice item. An empty
-- selection clears the answer.
CREATE FUNCTION submission.save_choice_answer(
    p_tenant_id uuid,
    p_attempt_id uuid,
    p_exam_item_id uuid,
    p_selected integer[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz, submission
AS $function$
DECLARE
    attempt_record submission.attempts%ROWTYPE;
    item_record submission.assignment_item_projections%ROWTYPE;
    saved submission.choice_answers%ROWTYPE;
BEGIN
    PERFORM submission.require_authorized_context(p_tenant_id, 'submission.write', 'submission.attempts');
    SELECT * INTO attempt_record FROM submission.attempts
    WHERE tenant_id = p_tenant_id AND id = p_attempt_id AND deleted_at IS NULL
    FOR UPDATE;
    IF NOT FOUND OR attempt_record.candidate_id <> authz.current_context_actor_id() THEN
        RAISE EXCEPTION 'candidate attempt was not found' USING ERRCODE = 'P0001';
    END IF;
    IF attempt_record.lifecycle_state <> 'active'
       OR clock_timestamp() >= attempt_record.submission_deadline + submission.answer_grace() THEN
        RAISE EXCEPTION 'attempt is no longer accepting answers' USING ERRCODE = '55000',
            DETAIL = 'candidate: This exam has ended. Changes are no longer saved.';
    END IF;
    SELECT * INTO item_record FROM submission.assignment_item_projections
    WHERE tenant_id = p_tenant_id AND candidate_assignment_id = attempt_record.candidate_assignment_id
      AND exam_item_id = p_exam_item_id;
    IF NOT FOUND OR item_record.kind <> 'mcq' THEN
        RAISE EXCEPTION 'multiple-choice question was not found' USING ERRCODE = 'P0001';
    END IF;
    IF p_selected IS NULL
       OR (SELECT count(DISTINCT value) FROM unnest(p_selected) AS value) <> cardinality(p_selected)
       OR EXISTS (SELECT 1 FROM unnest(p_selected) AS value
                  WHERE value IS NULL OR value < 0 OR value >= jsonb_array_length(item_record.choices))
       OR (NOT item_record.multiple_choice AND cardinality(p_selected) > 1) THEN
        RAISE EXCEPTION 'the selection is invalid' USING ERRCODE = '22023';
    END IF;
    INSERT INTO submission.choice_answers AS existing (tenant_id, attempt_id, exam_item_id, selected)
    VALUES (p_tenant_id, p_attempt_id, p_exam_item_id, p_selected)
    ON CONFLICT (tenant_id, attempt_id, exam_item_id) DO UPDATE
    SET selected = EXCLUDED.selected, revision_number = existing.revision_number + 1, saved_at = clock_timestamp()
    RETURNING * INTO saved;
    RETURN jsonb_build_object('exam_item_id', saved.exam_item_id, 'selected', to_jsonb(saved.selected),
                              'revision_number', saved.revision_number, 'saved_at', saved.saved_at);
END
$function$;
REVOKE ALL ON FUNCTION submission.save_choice_answer(uuid, uuid, uuid, integer[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submission.save_choice_answer(uuid, uuid, uuid, integer[]) TO aether_submission_app;

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
    p_duration_seconds integer,
    p_title text,
    p_instructions_markdown text
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
        duration_seconds, title, instructions_markdown
    ) VALUES (
        p_tenant_id, p_candidate_assignment_id, p_candidate_id, p_exam_id, p_exam_version_id,
        p_available_from, p_available_until, p_attempt_limit, p_lifecycle_state, p_version, p_source_event_id,
        p_duration_seconds, p_title, p_instructions_markdown
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
        title = EXCLUDED.title,
        instructions_markdown = EXCLUDED.instructions_markdown,
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
        sample_bundle_key_reference, time_limit_ms, memory_limit_kib, supported_languages,
        position, title, prompt_markdown, kind, choices, correct_choices, multiple_choice
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
        END,
        ordinal::integer,
        NULLIF(item ->> 'title', ''),
        NULLIF(item ->> 'prompt_markdown', ''),
        COALESCE(item ->> 'kind', 'coding'),
        CASE WHEN jsonb_typeof(item -> 'choices') = 'array' THEN item -> 'choices' END,
        CASE WHEN jsonb_typeof(item -> 'correct_choices') = 'array'
             THEN ARRAY(SELECT jsonb_array_elements_text(item -> 'correct_choices')::integer)
        END,
        COALESCE((item ->> 'multiple_choice')::boolean, false)
    FROM jsonb_array_elements(p_items) WITH ORDINALITY AS element(item, ordinal);

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

CREATE OR REPLACE FUNCTION submission.get_attempt_paper_for_candidate(
    p_tenant_id uuid,
    p_attempt_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, submission, authz
AS $function$
DECLARE
    signed_actor_id uuid;
    attempt_row submission.attempts%ROWTYPE;
    assignment_row submission.assignment_projections%ROWTYPE;
    items jsonb;
BEGIN
    IF NOT authz.current_context_allows_read(
        p_tenant_id, 'submission.read', 'submission.write', 'submission.attempts'
    ) THEN
        RAISE EXCEPTION 'signed authorization context does not allow this submission operation'
            USING ERRCODE = '42501';
    END IF;
    signed_actor_id := authz.current_context_actor_id();
    IF signed_actor_id IS NULL THEN
        RAISE EXCEPTION 'current authorization context has no actor' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO attempt_row
    FROM submission.attempts AS attempt
    WHERE attempt.tenant_id = p_tenant_id
      AND attempt.id = p_attempt_id
      AND attempt.candidate_id = signed_actor_id
      AND attempt.deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'candidate attempt was not found' USING ERRCODE = 'P0001';
    END IF;
    SELECT * INTO assignment_row
    FROM submission.assignment_projections
    WHERE tenant_id = p_tenant_id AND candidate_assignment_id = attempt_row.candidate_assignment_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'candidate attempt was not found' USING ERRCODE = 'P0001';
    END IF;

    -- Storage references of the latest saved answer go to the service, which
    -- decrypts the source; they never reach the candidate.
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'exam_item_id', item.exam_item_id,
               'position', item.position,
               'title', item.title,
               'prompt_markdown', item.prompt_markdown,
               'maximum_score', item.maximum_score::text,
               'supported_languages', to_jsonb(item.supported_languages),
               'time_limit_ms', item.time_limit_ms,
               'memory_limit_kib', item.memory_limit_kib,
               'kind', item.kind,
               'multiple_choice', item.multiple_choice,
               -- Options in an order of their own for each attempt, with their
               -- authored index; the answer key never leaves the database.
               'choices', CASE WHEN item.kind = 'mcq' THEN (
                   SELECT jsonb_agg(jsonb_build_object('index', option.ordinal - 1, 'text', option.text)
                                    ORDER BY md5(p_attempt_id::text || item.exam_item_id::text || option.ordinal::text))
                   FROM jsonb_array_elements_text(item.choices) WITH ORDINALITY AS option(text, ordinal)
               ) END,
               'latest_choice', (
                   SELECT to_jsonb(choice.selected) FROM submission.choice_answers AS choice
                   WHERE choice.tenant_id = p_tenant_id AND choice.attempt_id = p_attempt_id
                     AND choice.exam_item_id = item.exam_item_id
               ),
               'latest_answer', CASE WHEN latest.id IS NULL THEN NULL ELSE jsonb_build_object(
                   'language', latest.language_id,
                   'revision_number', latest.revision_number,
                   'source_object_key', latest.source_object_key,
                   'source_checksum', lower(latest.source_checksum::text),
                   'encryption_key_reference', latest.encryption_key_reference
               ) END
           ) ORDER BY item.position NULLS LAST, item.exam_item_id), '[]'::jsonb)
    INTO items
    FROM submission.assignment_item_projections AS item
    LEFT JOIN LATERAL (
        SELECT revision.*
        FROM submission.answer_revisions AS revision
        WHERE revision.tenant_id = p_tenant_id
          AND revision.attempt_id = p_attempt_id
          AND revision.exam_item_id = item.exam_item_id
        ORDER BY revision.revision_number DESC
        LIMIT 1
    ) AS latest ON true
    WHERE item.tenant_id = p_tenant_id
      AND item.candidate_assignment_id = attempt_row.candidate_assignment_id;

    RETURN jsonb_build_object(
        'attempt_id', attempt_row.id,
        'exam_id', attempt_row.exam_id,
        'title', assignment_row.title,
        'instructions_markdown', assignment_row.instructions_markdown,
        'items', items
    );
END
$function$;

CREATE OR REPLACE FUNCTION submission.attempt_item_scores(p_tenant_id uuid, p_attempt_id uuid)
RETURNS TABLE (exam_item_id uuid, score numeric, maximum_score numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, submission
AS $function$
    SELECT revision.exam_item_id,
           max(submission.evaluation_score(p_tenant_id, request_row.id)),
           max(request_row.maximum_score)
    FROM submission.evaluation_requests AS request_row
    JOIN submission.answer_revisions AS revision
      ON revision.tenant_id = request_row.tenant_id
     AND revision.id = request_row.answer_revision_id
    WHERE request_row.tenant_id = p_tenant_id
      AND request_row.attempt_id = p_attempt_id
    GROUP BY revision.exam_item_id
    UNION ALL
    -- Multiple choice is all-or-nothing: the selection must equal the key.
    SELECT item.exam_item_id,
           CASE WHEN choice.selected IS NOT NULL
                     AND (SELECT array_agg(value ORDER BY value) FROM unnest(choice.selected) AS value)
                       = (SELECT array_agg(value ORDER BY value) FROM unnest(item.correct_choices) AS value)
                THEN item.maximum_score ELSE 0 END,
           item.maximum_score
    FROM submission.attempts AS attempt
    JOIN submission.assignment_item_projections AS item
      ON item.tenant_id = attempt.tenant_id AND item.candidate_assignment_id = attempt.candidate_assignment_id
     AND item.kind = 'mcq'
    JOIN submission.choice_answers AS choice
      ON choice.tenant_id = attempt.tenant_id AND choice.attempt_id = attempt.id AND choice.exam_item_id = item.exam_item_id
    WHERE attempt.tenant_id = p_tenant_id AND attempt.id = p_attempt_id
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
    -- A multiple-choice selection is an answer too (ADR-0035).
    IF NOT EXISTS (
        SELECT 1
        FROM submission.answer_revisions AS revision
        WHERE revision.tenant_id = p_tenant_id AND revision.attempt_id = p_attempt_id
    ) AND NOT EXISTS (
        SELECT 1 FROM submission.choice_answers AS choice
        WHERE choice.tenant_id = p_tenant_id AND choice.attempt_id = p_attempt_id
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
               revision.id, revision.tenant_id, revision.exam_item_id, revision.revision_number
        FROM submission.answer_revisions AS revision
        WHERE revision.tenant_id = p_tenant_id
          AND revision.attempt_id = p_attempt_id
        ORDER BY revision.exam_item_id, revision.revision_number DESC
    ) AS latest_revision
    JOIN submission.assignment_item_projections AS item
      ON item.tenant_id = p_tenant_id
     AND item.candidate_assignment_id = attempt_record.candidate_assignment_id
     AND item.exam_item_id = latest_revision.exam_item_id
    -- Code already submitted per question needs no second evaluation (ADR-0025).
    WHERE NOT EXISTS (
        SELECT 1 FROM submission.evaluation_requests AS evaluated
        WHERE evaluated.tenant_id = p_tenant_id
          AND evaluated.answer_revision_id = latest_revision.id
    );
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
    IF NOT EXISTS (
        SELECT 1 FROM submission.answer_revisions AS revision
        WHERE revision.tenant_id = p_tenant_id AND revision.attempt_id = p_attempt_id
    ) AND NOT EXISTS (
        SELECT 1 FROM submission.choice_answers AS choice
        WHERE choice.tenant_id = p_tenant_id AND choice.attempt_id = p_attempt_id
    ) THEN
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

    -- Latest revisions not already evaluated by a per-question submit.
    SELECT count(*) INTO expected_count
    FROM (
        SELECT DISTINCT ON (revision.exam_item_id) revision.id, revision.tenant_id
        FROM submission.answer_revisions AS revision
        WHERE revision.tenant_id = p_tenant_id
          AND revision.attempt_id = p_attempt_id
        ORDER BY revision.exam_item_id, revision.revision_number DESC
    ) AS latest_revision
    WHERE NOT EXISTS (
        SELECT 1 FROM submission.evaluation_requests AS evaluated
        WHERE evaluated.tenant_id = latest_revision.tenant_id
          AND evaluated.answer_revision_id = latest_revision.id
    );
    IF request_count <> expected_count THEN
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
        ), pending AS (
            SELECT latest.* FROM latest
            WHERE NOT EXISTS (
                SELECT 1 FROM submission.evaluation_requests AS evaluated
                WHERE evaluated.tenant_id = p_tenant_id
                  AND evaluated.answer_revision_id = latest.answer_revision_id
            )
        )
        SELECT 1
        FROM requested
        FULL OUTER JOIN pending AS latest USING (answer_revision_id)
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

    -- When every answer was already submitted and judged, nothing new is
    -- queued and no completion will arrive to grade the attempt: grade it now.
    IF submission.finalize_attempt_grading(p_tenant_id, p_attempt_id, pg_catalog.uuidv7(), pg_catalog.uuidv7(), pg_catalog.uuidv7()) THEN
        SELECT * INTO attempt_record FROM submission.attempts WHERE tenant_id = p_tenant_id AND id = p_attempt_id;
    END IF;

    RETURN QUERY
    SELECT attempt_record.id, attempt_record.tenant_id, attempt_record.exam_id, attempt_record.exam_version_id,
           attempt_record.candidate_id, attempt_record.candidate_assignment_id, attempt_record.attempt_number,
           attempt_record.lifecycle_state, attempt_record.available_from, attempt_record.submission_deadline,
           attempt_record.started_at, attempt_record.submitted_at, attempt_record.completed_at,
           attempt_record.version, attempt_record.created_at;
END
$function$;

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
        WITH newest AS (
            SELECT DISTINCT ON (revision.exam_item_id) revision.id, revision.exam_item_id
            FROM submission.answer_revisions AS revision
            WHERE revision.tenant_id = attempt_row.tenant_id
              AND revision.attempt_id = attempt_row.id
            ORDER BY revision.exam_item_id, revision.revision_number DESC
        ), latest AS (
            -- Code already submitted per question needs no second evaluation.
            SELECT newest.* FROM newest
            WHERE NOT EXISTS (
                SELECT 1 FROM submission.evaluation_requests AS evaluated
                WHERE evaluated.tenant_id = attempt_row.tenant_id
                  AND evaluated.answer_revision_id = newest.id
            )
        ), inserted AS (
            INSERT INTO submission.evaluation_requests (
                id, tenant_id, attempt_id, answer_revision_id,
                evaluation_bundle_object_key, evaluation_bundle_checksum,
                caller_idempotency_key, maximum_score
            )
            SELECT pg_catalog.uuidv7(), attempt_row.tenant_id, attempt_row.id, latest.id,
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
        SELECT pg_catalog.uuidv7(), 'evaluation_request', announced.id, attempt_row.tenant_id,
               'submission.evaluation_requested.v1', 1, announced.payload,
               extensions.digest(convert_to(announced.payload::text, 'UTF8'), 'sha256'), clock_timestamp()
        FROM announced;
        GET DIAGNOSTICS request_count = ROW_COUNT;

        IF request_count = 0 AND NOT EXISTS (
            SELECT 1 FROM submission.answer_revisions AS revision
            WHERE revision.tenant_id = attempt_row.tenant_id AND revision.attempt_id = attempt_row.id
        ) AND NOT EXISTS (
            SELECT 1 FROM submission.choice_answers AS choice
            WHERE choice.tenant_id = attempt_row.tenant_id AND choice.attempt_id = attempt_row.id
        ) THEN
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
                pg_catalog.uuidv7(), 'attempt', attempt_row.id, attempt_row.tenant_id,
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
                (pg_catalog.uuidv7(), attempt_row.tenant_id, attempt_row.id, 'submission.attempt.submitted.v1',
                 jsonb_build_object('attempt_id', attempt_row.id, 'evaluation_request_count', request_count, 'reason', 'time_up')),
                (pg_catalog.uuidv7(), attempt_row.tenant_id, attempt_row.id, 'submission.attempt.grading.v1',
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
                pg_catalog.uuidv7(), 'attempt', attempt_row.id, attempt_row.tenant_id,
                'submission.attempt_submitted.v1', 1, event_payload,
                extensions.digest(convert_to(event_payload::text, 'UTF8'), 'sha256'), attempt_row.submitted_at
            );
            -- Every answer was already submitted per question: grade now.
            PERFORM submission.finalize_attempt_grading(
                attempt_row.tenant_id, attempt_row.id, pg_catalog.uuidv7(), pg_catalog.uuidv7(), pg_catalog.uuidv7()
            );
        END IF;

        expired_count := expired_count + 1;
    END LOOP;

    RETURN expired_count;
END
$function$;

CREATE OR REPLACE FUNCTION submission.finalize_attempt_grading(
    p_tenant_id uuid,
    p_attempt_id uuid,
    p_attempt_event_id uuid,
    p_score_summary_id uuid,
    p_outbox_event_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, submission, extensions
AS $function$
DECLARE
    attempt_record submission.attempts%ROWTYPE;
    final_score numeric(12,4);
    final_maximum_score numeric(12,4);
    event_payload jsonb;
BEGIN
    SELECT * INTO attempt_record
    FROM submission.attempts
    WHERE tenant_id = p_tenant_id AND id = p_attempt_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'evaluation request has no attempt' USING ERRCODE = 'P0001';
    END IF;
    -- A per-question submit completes while the candidate is still working;
    -- only an attempt that was handed in (or timed out) is graded.
    IF attempt_record.lifecycle_state <> 'grading' THEN
        RETURN false;
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

    -- Each coding item scores its best evaluation and each multiple-choice item
    -- its selection (attempt_item_scores). The maximum is every item the
    -- candidate was given, answered or not (ADR-0035): it used to count only
    -- answered items, so skipping a question raised the percentage.
    -- An attempt without projected items (data older than item projections)
    -- falls back to the items it was evaluated on.
    SELECT COALESCE(sum(scored.score), 0), COALESCE(sum(scored.maximum_score), 0)
    INTO final_score, final_maximum_score
    FROM submission.attempt_item_scores(p_tenant_id, attempt_record.id) AS scored;
    SELECT COALESCE(NULLIF(sum(item.maximum_score), 0), final_maximum_score) INTO final_maximum_score
    FROM submission.assignment_item_projections AS item
    WHERE item.tenant_id = p_tenant_id AND item.candidate_assignment_id = attempt_record.candidate_assignment_id;

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
        'finalized', 4, clock_timestamp()
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
            'tenant_id', attempt_record.tenant_id,
            'candidate_assignment_id', attempt_record.candidate_assignment_id,
            'candidate_id', attempt_record.candidate_id,
            'exam_id', attempt_record.exam_id,
            'exam_version_id', attempt_record.exam_version_id,
            'attempt_number', attempt_record.attempt_number,
            'lifecycle_state', attempt_record.lifecycle_state,
            'score', final_score,
            'maximum_score', final_maximum_score
        )
    );

    event_payload := jsonb_build_object(
        'attempt_id', attempt_record.id,
        'tenant_id', attempt_record.tenant_id,
        'candidate_assignment_id', attempt_record.candidate_assignment_id,
        'candidate_id', attempt_record.candidate_id,
        'exam_id', attempt_record.exam_id,
        'exam_version_id', attempt_record.exam_version_id,
        'attempt_number', attempt_record.attempt_number,
        'lifecycle_state', attempt_record.lifecycle_state,
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

RESET ROLE;
