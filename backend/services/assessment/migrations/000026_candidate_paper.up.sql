-- Candidates read their exam from Submission's projection (ADR-0023), so the
-- paper travels with the candidate assignment snapshot:
-- * exam items pin the question version's title and statement next to its
--   bundles (a published version is immutable, so the copy never drifts);
--   legacy items keep NULLs (both-or-none);
-- * snapshots carry the exam version's title and instructions and each item's
--   title and statement;
-- * the candidate's assignment list carries the exam id, title, instructions
--   and duration, so the dashboard and the SEB launch file need no staff read.
-- Upgrade Submission first: its snapshot decoder rejects unknown fields.
SET ROLE aether_assessment_owner;

ALTER TABLE assessment.exam_items
    ADD COLUMN question_title text CHECK (question_title IS NULL OR length(question_title) BETWEEN 1 AND 300),
    ADD COLUMN prompt_markdown text CHECK (prompt_markdown IS NULL OR length(prompt_markdown) BETWEEN 1 AND 200000),
    ADD CONSTRAINT statement_complete CHECK ((question_title IS NULL) = (prompt_markdown IS NULL));

-- Keep the previous add_exam_item(...) overload installed (but not executable
-- by the app role) so the paired rollback restores the exact prior contract.
REVOKE EXECUTE ON FUNCTION assessment.add_exam_item(
    uuid, uuid, uuid, uuid, bigint, integer, uuid, uuid, numeric, text, text, text, text, text, text, integer, integer, text[]
) FROM aether_assessment_app;

CREATE FUNCTION assessment.add_exam_item(
    p_id uuid,
    p_tenant_id uuid,
    p_exam_version_id uuid,
    p_section_id uuid,
    p_expected_content_version bigint,
    p_position integer,
    p_question_id uuid,
    p_question_version_id uuid,
    p_maximum_score numeric(12,4),
    p_evaluation_bundle_object_key text,
    p_evaluation_bundle_checksum text,
    p_evaluation_bundle_key_reference text,
    p_sample_bundle_object_key text,
    p_sample_bundle_checksum text,
    p_sample_bundle_key_reference text,
    p_time_limit_ms integer,
    p_memory_limit_kib integer,
    p_supported_languages text[],
    p_question_title text,
    p_prompt_markdown text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, assessment, authz
AS $function$
DECLARE version_row assessment.exam_versions%ROWTYPE;
BEGIN
    IF p_id IS NULL OR p_tenant_id IS NULL OR p_exam_version_id IS NULL OR p_section_id IS NULL
       OR p_expected_content_version IS NULL OR p_expected_content_version <= 0
       OR p_position IS NULL OR p_position <= 0
       OR p_question_id IS NULL OR p_question_version_id IS NULL
       OR p_maximum_score IS NULL OR p_maximum_score <= 0
       OR p_evaluation_bundle_object_key IS NULL
       OR length(p_evaluation_bundle_object_key) NOT BETWEEN 1 AND 1024
       OR p_evaluation_bundle_object_key !~ '^[A-Za-z0-9][A-Za-z0-9._/=@+-]*$'
       OR p_evaluation_bundle_object_key ~ '(^|/)\.\.(/|$)'
       OR p_evaluation_bundle_checksum IS NULL OR p_evaluation_bundle_checksum !~* '^[0-9a-f]{64}$'
       OR p_evaluation_bundle_key_reference IS NULL OR length(p_evaluation_bundle_key_reference) NOT BETWEEN 1 AND 255
       OR p_sample_bundle_object_key IS NULL
       OR length(p_sample_bundle_object_key) NOT BETWEEN 1 AND 1024
       OR p_sample_bundle_object_key !~ '^[A-Za-z0-9][A-Za-z0-9._/=@+-]*$'
       OR p_sample_bundle_object_key ~ '(^|/)\.\.(/|$)'
       OR p_sample_bundle_checksum IS NULL OR p_sample_bundle_checksum !~* '^[0-9a-f]{64}$'
       OR p_sample_bundle_key_reference IS NULL OR length(p_sample_bundle_key_reference) NOT BETWEEN 1 AND 255
       OR p_time_limit_ms IS NULL OR p_time_limit_ms NOT BETWEEN 50 AND 600000
       OR p_memory_limit_kib IS NULL OR p_memory_limit_kib NOT BETWEEN 1024 AND 4194304
       OR p_supported_languages IS NULL OR cardinality(p_supported_languages) NOT BETWEEN 1 AND 32
       OR array_position(p_supported_languages, NULL) IS NOT NULL
       OR p_question_title IS NULL OR length(p_question_title) NOT BETWEEN 1 AND 300
       OR p_prompt_markdown IS NULL OR length(p_prompt_markdown) NOT BETWEEN 1 AND 200000 THEN
        RAISE EXCEPTION 'invalid exam item command' USING ERRCODE = '22023';
    END IF;
    IF NOT authz.current_context_allows(p_tenant_id, 'assessment.write', 'assessment.exam_items') THEN
        RAISE EXCEPTION 'authorization denied' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO version_row
    FROM assessment.exam_versions
    WHERE id = p_exam_version_id AND tenant_id = p_tenant_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'exam version was not found' USING ERRCODE = 'P0002';
    END IF;
    IF version_row.status <> 'draft' THEN
        RAISE EXCEPTION 'published exam version is immutable' USING ERRCODE = '40001';
    END IF;
    IF version_row.content_version <> p_expected_content_version THEN
        RAISE EXCEPTION 'exam content version is stale' USING ERRCODE = '40001';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM assessment.exam_sections
        WHERE id = p_section_id AND tenant_id = p_tenant_id AND exam_version_id = p_exam_version_id
    ) THEN
        RAISE EXCEPTION 'exam section was not found' USING ERRCODE = 'P0002';
    END IF;

    INSERT INTO assessment.exam_items (
        id, tenant_id, exam_version_id, section_id, position, question_id, question_version_id,
        maximum_score, evaluation_bundle_object_key, evaluation_bundle_checksum, evaluation_bundle_key_reference,
        sample_bundle_object_key, sample_bundle_checksum, sample_bundle_key_reference,
        time_limit_ms, memory_limit_kib, supported_languages, question_title, prompt_markdown
    ) VALUES (
        p_id, p_tenant_id, p_exam_version_id, p_section_id, p_position, p_question_id, p_question_version_id,
        p_maximum_score, p_evaluation_bundle_object_key, p_evaluation_bundle_checksum, p_evaluation_bundle_key_reference,
        p_sample_bundle_object_key, p_sample_bundle_checksum, p_sample_bundle_key_reference,
        p_time_limit_ms, p_memory_limit_kib, p_supported_languages, p_question_title, p_prompt_markdown
    );
    UPDATE assessment.exam_versions
    SET content_version = content_version + 1
    WHERE id = p_exam_version_id AND tenant_id = p_tenant_id;
END
$function$;

REVOKE ALL ON FUNCTION assessment.add_exam_item(
    uuid, uuid, uuid, uuid, bigint, integer, uuid, uuid, numeric, text, text, text, text, text, text, integer, integer, text[], text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assessment.add_exam_item(
    uuid, uuid, uuid, uuid, bigint, integer, uuid, uuid, numeric, text, text, text, text, text, text, integer, integer, text[], text, text
) TO aether_assessment_app;

-- Snapshots carry the paper.
CREATE OR REPLACE FUNCTION assessment.enqueue_candidate_assignment_snapshot(
    p_event_id uuid,
    p_tenant_id uuid,
    p_candidate_assignment_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, assessment, app, extensions
AS $function$
DECLARE
    assignment_row assessment.candidate_assignments%ROWTYPE;
    version_row assessment.exam_versions%ROWTYPE;
    snapshot_state text;
    item_snapshots jsonb;
    item_count integer;
    distinct_item_count integer;
    incomplete_item_count integer;
    snapshot_payload jsonb;
BEGIN
    IF p_event_id IS NULL OR p_tenant_id IS NULL OR p_candidate_assignment_id IS NULL THEN
        RAISE EXCEPTION 'candidate assignment snapshot identifiers are required' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO assignment_row
    FROM assessment.candidate_assignments
    WHERE id = p_candidate_assignment_id AND tenant_id = p_tenant_id
    FOR KEY SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'candidate assignment was not found' USING ERRCODE = 'P0002';
    END IF;

    snapshot_state := CASE assignment_row.lifecycle_state
        WHEN 'assigned' THEN 'active'
        WHEN 'revoked' THEN 'revoked'
        ELSE NULL
    END;
    IF snapshot_state IS NULL THEN
        RAISE EXCEPTION 'candidate assignment lifecycle cannot be snapshotted' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO version_row
    FROM assessment.exam_versions
    WHERE id = assignment_row.exam_version_id AND tenant_id = p_tenant_id
    FOR KEY SHARE;
    IF NOT FOUND OR version_row.status <> 'published' THEN
        RAISE EXCEPTION 'published exam version was not found' USING ERRCODE = '40001';
    END IF;

    SELECT
        COALESCE(jsonb_agg(item_snapshot ORDER BY section_position, item_position), '[]'::jsonb),
        count(*),
        count(DISTINCT exam_item_id),
        count(*) FILTER (
            WHERE evaluation_bundle_object_key IS NULL
               OR length(btrim(evaluation_bundle_object_key)) = 0
               OR evaluation_bundle_checksum IS NULL
        )
    INTO item_snapshots, item_count, distinct_item_count, incomplete_item_count
    FROM (
        SELECT
            section.position AS section_position,
            item.position AS item_position,
            item.id AS exam_item_id,
            item.evaluation_bundle_object_key,
            item.evaluation_bundle_checksum,
            jsonb_build_object(
                'exam_item_id', item.id::text,
                'evaluation_bundle_object_key', item.evaluation_bundle_object_key,
                'evaluation_bundle_checksum', lower(item.evaluation_bundle_checksum::text),
                'maximum_score', item.maximum_score,
                'evaluation_bundle_key_reference', item.evaluation_bundle_key_reference,
                'sample_bundle_object_key', item.sample_bundle_object_key,
                'sample_bundle_checksum', lower(item.sample_bundle_checksum::text),
                'sample_bundle_key_reference', item.sample_bundle_key_reference,
                'time_limit_ms', item.time_limit_ms,
                'memory_limit_kib', item.memory_limit_kib,
                'supported_languages', to_jsonb(item.supported_languages),
                'title', item.question_title,
                'prompt_markdown', item.prompt_markdown
            ) AS item_snapshot
        FROM assessment.exam_sections AS section
        JOIN assessment.exam_items AS item
          ON item.tenant_id = section.tenant_id
         AND item.exam_version_id = section.exam_version_id
         AND item.section_id = section.id
        WHERE section.tenant_id = p_tenant_id
          AND section.exam_version_id = assignment_row.exam_version_id
    ) AS ordered_item;

    IF snapshot_state = 'active' AND (
        item_count < 1 OR distinct_item_count <> item_count OR incomplete_item_count > 0
    ) THEN
        RAISE EXCEPTION 'active candidate assignment lacks a durable evaluation bundle snapshot' USING ERRCODE = '22023';
    END IF;
    -- A legacy assignment may be revoked after its historical bundle references
    -- have expired. An empty revoked item set is valid and prevents emitting a
    -- malformed payload that a downstream strict consumer could not apply.
    IF snapshot_state = 'revoked' AND (
        distinct_item_count <> item_count OR incomplete_item_count > 0
    ) THEN
        item_snapshots := '[]'::jsonb;
    END IF;

    snapshot_payload := jsonb_build_object(
        'tenant_id', p_tenant_id::text,
        'candidate_assignment_id', assignment_row.id::text,
        'candidate_id', assignment_row.candidate_id::text,
        'exam_id', version_row.exam_id::text,
        'exam_version_id', version_row.id::text,
        'available_from', to_char(assignment_row.available_from AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'available_until', to_char(assignment_row.available_until AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'attempt_limit', version_row.attempt_limit,
        'duration_seconds', version_row.duration_seconds,
        'title', version_row.title,
        'instructions_markdown', version_row.instructions_markdown,
        'lifecycle_state', snapshot_state,
        'version', assignment_row.version,
        'items', item_snapshots
    );

    INSERT INTO app.outbox_events (
        event_id, tenant_id, aggregate_type, aggregate_id, event_type, schema_version,
        payload, payload_sha256, occurred_at, next_attempt_at
    ) VALUES (
        p_event_id, p_tenant_id, 'candidate_assignment', assignment_row.id,
        'assessment.candidate_assignment.snapshot.v1', 1,
        snapshot_payload, extensions.digest(convert_to(snapshot_payload::text, 'UTF8'), 'sha256'),
        clock_timestamp(), clock_timestamp()
    );
END
$function$;

CREATE OR REPLACE FUNCTION assessment.materialize_candidate(
    p_tenant_id uuid,
    p_principal_id uuid,
    p_batch_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, assessment, app, extensions
AS $function$
DECLARE
    rule_record RECORD;
    version_row assessment.exam_versions%ROWTYPE;
    assignment_id uuid;
    snapshot_event_id uuid;
    candidate_state text;
    candidate_version bigint;
    item_snapshots jsonb;
    item_count integer;
    snapshot_payload jsonb;
BEGIN
    FOR rule_record IN
        SELECT ar.id AS rule_id, ar.exam_version_id, ar.available_from, ar.available_until
        FROM assessment.assignment_rules AS ar
        WHERE ar.tenant_id = p_tenant_id
          AND ar.disabled_at IS NULL
          AND ar.available_until > clock_timestamp()
          AND (
              (ar.target_type = 'batch' AND ar.target_id = p_batch_id)
              OR (ar.target_type = 'department' AND ar.target_id IN (
                  SELECT department_id
                  FROM assessment.batch_department_projections
                  WHERE tenant_id = p_tenant_id AND batch_id = p_batch_id
              ))
          )
          AND NOT EXISTS (
              SELECT 1
              FROM assessment.candidate_assignments AS ca
              WHERE ca.tenant_id = p_tenant_id
                AND ca.exam_version_id = ar.exam_version_id
                AND ca.candidate_id = p_principal_id
          )
    LOOP
        assignment_id := extensions.uuid_generate_v7();
        snapshot_event_id := extensions.uuid_generate_v7();

        SELECT * INTO version_row
        FROM assessment.exam_versions
        WHERE id = rule_record.exam_version_id AND tenant_id = p_tenant_id
        FOR KEY SHARE;
        IF NOT FOUND OR version_row.status <> 'published' THEN
            CONTINUE;
        END IF;

        SELECT COALESCE(jsonb_agg(item_snapshot ORDER BY section_position, item_position), '[]'::jsonb), count(*)
        INTO item_snapshots, item_count
        FROM (
            SELECT section.position AS section_position,
                   item.position AS item_position,
                   jsonb_build_object(
                       'exam_item_id', item.id::text,
                       'evaluation_bundle_object_key', item.evaluation_bundle_object_key,
                       'evaluation_bundle_checksum', item.evaluation_bundle_checksum,
                       'maximum_score', item.maximum_score,
                       'evaluation_bundle_key_reference', item.evaluation_bundle_key_reference,
                       'sample_bundle_object_key', item.sample_bundle_object_key,
                       'sample_bundle_checksum', lower(item.sample_bundle_checksum::text),
                       'sample_bundle_key_reference', item.sample_bundle_key_reference,
                       'time_limit_ms', item.time_limit_ms,
                       'memory_limit_kib', item.memory_limit_kib,
                       'supported_languages', to_jsonb(item.supported_languages),
                       'title', item.question_title,
                       'prompt_markdown', item.prompt_markdown
                   ) AS item_snapshot
            FROM assessment.exam_sections AS section
            JOIN assessment.exam_items AS item
              ON item.tenant_id = section.tenant_id
             AND item.exam_version_id = section.exam_version_id
             AND item.section_id = section.id
            WHERE section.tenant_id = p_tenant_id
              AND section.exam_version_id = rule_record.exam_version_id
            ORDER BY section.position, item.position
        ) AS ordered_item;
        IF item_count < 1 OR EXISTS (
            SELECT 1 FROM assessment.exam_items
            WHERE tenant_id = p_tenant_id
              AND exam_version_id = rule_record.exam_version_id
              AND evaluation_bundle_object_key IS NULL
        ) THEN
            CONTINUE;
        END IF;

        INSERT INTO assessment.candidate_assignments (
            id, tenant_id, assignment_rule_id, exam_version_id, candidate_id,
            available_from, available_until
        ) VALUES (
            assignment_id, p_tenant_id, rule_record.rule_id, rule_record.exam_version_id,
            p_principal_id, rule_record.available_from, rule_record.available_until
        ) RETURNING lifecycle_state, version INTO candidate_state, candidate_version;

        snapshot_payload := jsonb_build_object(
            'tenant_id', p_tenant_id::text,
            'candidate_assignment_id', assignment_id::text,
            'candidate_id', p_principal_id::text,
            'exam_id', version_row.exam_id::text,
            'exam_version_id', version_row.id::text,
            'available_from', to_char(rule_record.available_from AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
            'available_until', to_char(rule_record.available_until AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
            'attempt_limit', version_row.attempt_limit,
            'duration_seconds', version_row.duration_seconds,
            'title', version_row.title,
            'instructions_markdown', version_row.instructions_markdown,
            'lifecycle_state', CASE WHEN candidate_state = 'assigned' THEN 'active' WHEN candidate_state = 'revoked' THEN 'revoked' ELSE NULL END,
            'version', candidate_version,
            'items', item_snapshots
        );
        IF snapshot_payload ->> 'lifecycle_state' IS NULL THEN
            RAISE EXCEPTION 'candidate assignment lifecycle cannot be snapshotted' USING ERRCODE = '22023';
        END IF;
        INSERT INTO app.outbox_events (
            event_id, tenant_id, aggregate_type, aggregate_id, event_type, schema_version,
            payload, payload_sha256, occurred_at, next_attempt_at
        ) VALUES (
            snapshot_event_id, p_tenant_id, 'candidate_assignment', assignment_id,
            'assessment.candidate_assignment.snapshot.v1', 1,
            snapshot_payload, extensions.digest(convert_to(snapshot_payload::text, 'UTF8'), 'sha256'),
            clock_timestamp(), clock_timestamp()
        );
    END LOOP;
END
$function$;

-- The candidate's assignment list carries what the dashboard shows.
CREATE OR REPLACE FUNCTION assessment.list_candidate_assignments(
    p_tenant_id uuid,
    p_limit integer,
    p_cursor_available_from timestamptz,
    p_cursor_id uuid,
    p_lifecycle_state text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, assessment, authz
AS $function$
DECLARE
    signed_actor_id uuid;
    response jsonb;
BEGIN
    signed_actor_id := authz.current_context_actor_id();
    IF signed_actor_id IS NULL THEN
        RAISE EXCEPTION 'current authorization context has no actor' USING ERRCODE = '42501';
    END IF;
    -- 101 accommodates the caller's limit+1 probe for next-page detection.
    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 101 THEN
        RAISE EXCEPTION 'assignment listing limit must be between 1 and 100' USING ERRCODE = '22023';
    END IF;
    IF (p_cursor_available_from IS NULL) <> (p_cursor_id IS NULL) THEN
        RAISE EXCEPTION 'assignment listing cursor must supply both parts' USING ERRCODE = '22023';
    END IF;

    SELECT COALESCE(jsonb_agg(row_to_json(item)::jsonb ORDER BY item.available_from DESC, item.id DESC), '[]'::jsonb)
    INTO response
    FROM (
        SELECT assignment.id,
               assignment.tenant_id,
               assignment.assignment_rule_id,
               assignment.exam_version_id,
               assignment.candidate_id,
               assignment.available_from,
               assignment.available_until,
               assignment.lifecycle_state,
               assignment.assigned_at,
               assignment.revoked_at,
               assignment.completed_at,
               assignment.version,
               version_row.exam_id,
               version_row.title,
               version_row.instructions_markdown,
               version_row.duration_seconds
        FROM assessment.candidate_assignments AS assignment
        JOIN assessment.exam_versions AS version_row
          ON version_row.tenant_id = assignment.tenant_id
         AND version_row.id = assignment.exam_version_id
        WHERE assignment.tenant_id = p_tenant_id
          AND assignment.candidate_id = signed_actor_id
          AND assignment.deleted_at IS NULL
          AND (p_lifecycle_state IS NULL OR assignment.lifecycle_state = p_lifecycle_state)
          AND (
                p_cursor_available_from IS NULL
                OR (assignment.available_from, assignment.id) < (p_cursor_available_from, p_cursor_id)
              )
        ORDER BY assignment.available_from DESC, assignment.id DESC
        LIMIT p_limit
    ) AS item;

    RETURN response;
END
$function$;

RESET ROLE;
