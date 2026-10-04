-- The assignment snapshot now carries what grading needs per exam item: the
-- evaluation bundle's key reference, the sample bundle, the execution limits and
-- the languages a candidate may answer in. Items projected before Assessment
-- migration 000024 keep NULLs; they cannot be answered or dispatched.
--
-- append_answer_revision now rejects a language the item does not list. The
-- source itself is encrypted and stored by the service, so this function only
-- records the references it is handed.
SET ROLE aether_submission_owner;

ALTER TABLE submission.assignment_item_projections
    ADD COLUMN evaluation_bundle_key_reference text
        CHECK (evaluation_bundle_key_reference IS NULL OR length(evaluation_bundle_key_reference) BETWEEN 1 AND 255),
    ADD COLUMN sample_bundle_object_key text
        CHECK (sample_bundle_object_key IS NULL OR length(sample_bundle_object_key) BETWEEN 1 AND 1024),
    ADD COLUMN sample_bundle_checksum char(64)
        CHECK (sample_bundle_checksum IS NULL OR sample_bundle_checksum ~* '^[0-9a-f]{64}$'),
    ADD COLUMN sample_bundle_key_reference text
        CHECK (sample_bundle_key_reference IS NULL OR length(sample_bundle_key_reference) BETWEEN 1 AND 255),
    ADD COLUMN time_limit_ms integer CHECK (time_limit_ms IS NULL OR time_limit_ms BETWEEN 50 AND 600000),
    ADD COLUMN memory_limit_kib integer CHECK (memory_limit_kib IS NULL OR memory_limit_kib BETWEEN 1024 AND 4194304),
    ADD COLUMN supported_languages text[]
        CHECK (supported_languages IS NULL OR cardinality(supported_languages) BETWEEN 1 AND 32),
    ADD CONSTRAINT sample_bundle_complete CHECK (
        (sample_bundle_object_key IS NULL) = (sample_bundle_checksum IS NULL)
        AND (sample_bundle_object_key IS NULL) = (sample_bundle_key_reference IS NULL)
    ),
    ADD CONSTRAINT execution_limits_complete CHECK (
        (time_limit_ms IS NULL) = (memory_limit_kib IS NULL)
        AND (time_limit_ms IS NULL) = (supported_languages IS NULL)
    );

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
    IF attempt_record.lifecycle_state <> 'active' OR clock_timestamp() >= attempt_record.submission_deadline THEN
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


RESET ROLE;
