-- Multiple-choice exam items (ADR-0035). An item is "coding" (bundles,
-- limits, languages) or "mcq" (options, answer key, single or multiple). The
-- snapshot carries the answer key to Submission, which grades server-side and
-- never puts it on a candidate's paper.
SET ROLE aether_assessment_owner;

ALTER TABLE assessment.exam_items
    ALTER COLUMN evaluation_bundle_checksum DROP NOT NULL,
    ADD COLUMN kind text NOT NULL DEFAULT 'coding' CHECK (kind IN ('coding', 'mcq')),
    ADD COLUMN choices jsonb CHECK (choices IS NULL OR (jsonb_typeof(choices) = 'array' AND jsonb_array_length(choices) BETWEEN 2 AND 10)),
    ADD COLUMN correct_choices integer[] CHECK (correct_choices IS NULL OR cardinality(correct_choices) BETWEEN 1 AND 10),
    ADD COLUMN multiple_choice boolean NOT NULL DEFAULT false,
    ADD CONSTRAINT exam_items_kind_complete CHECK (
        (kind = 'coding' AND evaluation_bundle_checksum IS NOT NULL AND choices IS NULL AND correct_choices IS NULL)
        OR (kind = 'mcq' AND choices IS NOT NULL AND correct_choices IS NOT NULL
            AND evaluation_bundle_object_key IS NULL AND evaluation_bundle_checksum IS NULL
            AND sample_bundle_object_key IS NULL AND time_limit_ms IS NULL
            AND question_title IS NOT NULL)
    );

CREATE FUNCTION assessment.add_exam_mcq_item(
    p_id uuid,
    p_tenant_id uuid,
    p_exam_version_id uuid,
    p_section_id uuid,
    p_expected_content_version bigint,
    p_position integer,
    p_question_id uuid,
    p_question_version_id uuid,
    p_maximum_score numeric(12,4),
    p_question_title text,
    p_prompt_markdown text,
    p_choices jsonb,
    p_correct_choices integer[],
    p_multiple_choice boolean
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
       OR p_question_title IS NULL OR length(p_question_title) NOT BETWEEN 1 AND 300
       OR p_prompt_markdown IS NULL OR length(p_prompt_markdown) NOT BETWEEN 1 AND 200000
       OR p_choices IS NULL OR jsonb_typeof(p_choices) <> 'array' OR jsonb_array_length(p_choices) NOT BETWEEN 2 AND 10
       OR p_correct_choices IS NULL OR cardinality(p_correct_choices) < 1
       OR EXISTS (SELECT 1 FROM unnest(p_correct_choices) AS correct
                  WHERE correct IS NULL OR correct < 0 OR correct >= jsonb_array_length(p_choices))
       OR p_multiple_choice IS NULL OR (NOT p_multiple_choice AND cardinality(p_correct_choices) <> 1) THEN
        RAISE EXCEPTION 'invalid exam item command' USING ERRCODE = '22023';
    END IF;
    IF NOT authz.current_context_allows(p_tenant_id, 'assessment.write', 'assessment.exam_items') THEN
        RAISE EXCEPTION 'authorization denied' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO version_row FROM assessment.exam_versions
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
        maximum_score, question_title, prompt_markdown, kind, choices, correct_choices, multiple_choice
    ) VALUES (
        p_id, p_tenant_id, p_exam_version_id, p_section_id, p_position, p_question_id, p_question_version_id,
        p_maximum_score, p_question_title, p_prompt_markdown, 'mcq', p_choices, p_correct_choices, p_multiple_choice
    );
    UPDATE assessment.exam_versions
    SET content_version = content_version + 1
    WHERE id = p_exam_version_id AND tenant_id = p_tenant_id;
END
$function$;
REVOKE ALL ON FUNCTION assessment.add_exam_mcq_item(uuid, uuid, uuid, uuid, bigint, integer, uuid, uuid, numeric, text, text, jsonb, integer[], boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assessment.add_exam_mcq_item(uuid, uuid, uuid, uuid, bigint, integer, uuid, uuid, numeric, text, text, jsonb, integer[], boolean) TO aether_assessment_app;

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
            WHERE item_kind = 'coding' AND (
                  evaluation_bundle_object_key IS NULL
               OR length(btrim(evaluation_bundle_object_key)) = 0
               OR evaluation_bundle_checksum IS NULL)
        )
    INTO item_snapshots, item_count, distinct_item_count, incomplete_item_count
    FROM (
        SELECT
            section.position AS section_position,
            item.position AS item_position,
            item.id AS exam_item_id,
            item.evaluation_bundle_object_key,
            item.evaluation_bundle_checksum,
            item.kind AS item_kind,
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
                'prompt_markdown', item.prompt_markdown,
                'kind', item.kind,
                'choices', item.choices,
                'correct_choices', to_jsonb(item.correct_choices),
                'multiple_choice', item.multiple_choice
            ) AS item_snapshot
        FROM assessment.exam_sections AS section
        JOIN assessment.exam_items AS item
          ON item.tenant_id = section.tenant_id
         AND item.exam_version_id = section.exam_version_id
         AND item.section_id = section.id
        WHERE section.tenant_id = p_tenant_id
          AND section.exam_version_id = assignment_row.exam_version_id
          AND assessment.item_drawn(section.tenant_id, section.id, section.draw_count, assignment_row.candidate_id, item.id)
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
    placement_department uuid;
BEGIN
    SELECT enrollment.placement_department_id INTO placement_department
    FROM assessment.student_batch_enrollments AS enrollment
    WHERE enrollment.tenant_id = p_tenant_id
      AND enrollment.principal_id = p_principal_id
      AND enrollment.status = 'active'
    ORDER BY enrollment.updated_at DESC
    LIMIT 1;

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
              OR (ar.target_type = 'placement_department' AND ar.target_id = placement_department)
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
                       'prompt_markdown', item.prompt_markdown,
                'kind', item.kind,
                'choices', item.choices,
                'correct_choices', to_jsonb(item.correct_choices),
                'multiple_choice', item.multiple_choice
                   ) AS item_snapshot
            FROM assessment.exam_sections AS section
            JOIN assessment.exam_items AS item
              ON item.tenant_id = section.tenant_id
             AND item.exam_version_id = section.exam_version_id
             AND item.section_id = section.id
            WHERE section.tenant_id = p_tenant_id
              AND section.exam_version_id = rule_record.exam_version_id
              AND assessment.item_drawn(section.tenant_id, section.id, section.draw_count, p_principal_id, item.id)
            ORDER BY section.position, item.position
        ) AS ordered_item;
        IF item_count < 1 OR EXISTS (
            SELECT 1 FROM assessment.exam_items
            WHERE tenant_id = p_tenant_id
              AND exam_version_id = rule_record.exam_version_id
              AND kind = 'coding' AND evaluation_bundle_object_key IS NULL
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

CREATE OR REPLACE FUNCTION assessment.get_exam_version_content(p_tenant_id uuid, p_exam_version_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, assessment, authz
AS $function$
BEGIN
    IF NOT authz.current_context_allows_read(p_tenant_id, 'assessment.read', 'assessment.write', 'assessment.exam_versions') THEN
        RAISE EXCEPTION 'authorization denied' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM assessment.exam_versions
        WHERE tenant_id = p_tenant_id AND id = p_exam_version_id
    ) THEN
        RAISE EXCEPTION 'exam version was not found' USING ERRCODE = 'P0002';
    END IF;
    RETURN jsonb_build_object(
        'sections', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                       'id', section.id,
                       'position', section.position,
                       'draw_count', section.draw_count,
                       'title', section.title,
                       'instructions_markdown', section.instructions_markdown,
                       'items', COALESCE((
                           SELECT jsonb_agg(jsonb_build_object(
                                      'id', item.id,
                                      'position', item.position,
                                      'question_id', item.question_id,
                                      'question_version_id', item.question_version_id,
                                      'question_title', item.question_title,
                               'kind', item.kind,
                                      'maximum_score', item.maximum_score::text
                                  ) ORDER BY item.position)
                           FROM assessment.exam_items AS item
                           WHERE item.tenant_id = section.tenant_id AND item.section_id = section.id
                       ), '[]'::jsonb)
                   ) ORDER BY section.position)
            FROM assessment.exam_sections AS section
            WHERE section.tenant_id = p_tenant_id AND section.exam_version_id = p_exam_version_id
        ), '[]'::jsonb),
        'assignment_rules', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                       'id', rule.id,
                       'target_type', rule.target_type,
                       'target_id', rule.target_id,
                       'available_from', rule.available_from,
                       'available_until', rule.available_until,
                       'disabled_at', rule.disabled_at,
                       'assigned_candidates', (
                           SELECT count(*) FROM assessment.candidate_assignments AS assignment
                           WHERE assignment.tenant_id = rule.tenant_id AND assignment.assignment_rule_id = rule.id
                             AND assignment.deleted_at IS NULL
                       )
                   ) ORDER BY rule.created_at, rule.id)
            FROM assessment.assignment_rules AS rule
            WHERE rule.tenant_id = p_tenant_id AND rule.exam_version_id = p_exam_version_id
        ), '[]'::jsonb)
    );
END
$function$;

RESET ROLE;
