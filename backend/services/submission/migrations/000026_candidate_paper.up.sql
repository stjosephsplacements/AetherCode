-- Candidates read their exam paper from this projection (ADR-0023). Assessment
-- snapshots now carry the exam's title and instructions and each item's title
-- and statement; items keep their order in the snapshot. Projections written
-- before this migration keep NULLs until Assessment re-snapshots them.
SET ROLE aether_submission_owner;

ALTER TABLE submission.assignment_projections
    ADD COLUMN title text CHECK (title IS NULL OR length(title) BETWEEN 1 AND 300),
    ADD COLUMN instructions_markdown text CHECK (instructions_markdown IS NULL OR length(instructions_markdown) > 0);

ALTER TABLE submission.assignment_item_projections
    ADD COLUMN position integer CHECK (position IS NULL OR position > 0),
    ADD COLUMN title text CHECK (title IS NULL OR length(title) BETWEEN 1 AND 300),
    ADD COLUMN prompt_markdown text CHECK (prompt_markdown IS NULL OR length(prompt_markdown) BETWEEN 1 AND 200000);

DROP FUNCTION submission.apply_assignment_snapshot(uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, timestamptz, smallint, text, bigint, jsonb, integer);

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
        position, title, prompt_markdown
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
        NULLIF(item ->> 'prompt_markdown', '')
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

REVOKE ALL ON FUNCTION submission.apply_assignment_snapshot(uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, timestamptz, smallint, text, bigint, jsonb, integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submission.apply_assignment_snapshot(uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, timestamptz, smallint, text, bigint, jsonb, integer, text, text)
    TO aether_submission_projection_worker;

-- The candidate's paper: the exam, each item's statement and limits, and the
-- latest saved answer's storage reference. Owner-bound like the unit summary.
CREATE FUNCTION submission.get_attempt_paper_for_candidate(
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

REVOKE ALL ON FUNCTION submission.get_attempt_paper_for_candidate(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submission.get_attempt_paper_for_candidate(uuid, uuid) TO aether_submission_app;

RESET ROLE;
