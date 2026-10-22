-- Repinning an exam item to a corrected question version (ADR-0039). After
-- staff fix a question's tests and publish the fix, an item of a published
-- exam may be repinned to it: the same question, coding, its bundles, limits
-- and statement replaced, marks unchanged. Every assignment of the exam
-- version is snapshotted again so Submission grades against the new tests.
SET ROLE aether_assessment_owner;

CREATE OR REPLACE FUNCTION assessment.reject_published_exam_child_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, assessment
AS $$
BEGIN
    -- repin_exam_item may update the one item it names, in its own
    -- transaction (ADR-0039); nothing else changes a published exam.
    -- Nested: only exam_items rows have the item columns read here.
    IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'exam_items' THEN
        IF current_setting('assessment.repinning_item', true) = OLD.id::text
           AND NEW.id = OLD.id AND NEW.exam_version_id = OLD.exam_version_id AND NEW.section_id = OLD.section_id
           AND NEW.maximum_score = OLD.maximum_score AND NEW.question_id = OLD.question_id THEN
            RETURN NEW;
        END IF;
    END IF;
    IF TG_OP IN ('UPDATE', 'DELETE') AND EXISTS (
        SELECT 1 FROM assessment.exam_versions exam_version
        WHERE exam_version.id = OLD.exam_version_id
          AND exam_version.published_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'published exam snapshot % is immutable', OLD.exam_version_id USING ERRCODE = '55000';
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') AND EXISTS (
        SELECT 1 FROM assessment.exam_versions exam_version
        WHERE exam_version.id = NEW.exam_version_id
          AND exam_version.published_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'content cannot be attached to published exam snapshot %', NEW.exam_version_id USING ERRCODE = '55000';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

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

    -- Submission knows an assignment as active or revoked. A started, completed
    -- or expired assignment is still active there; a regrade re-sends it with
    -- its corrected items (ADR-0039).
    snapshot_state := CASE assignment_row.lifecycle_state
        WHEN 'revoked' THEN 'revoked'
        ELSE 'active'
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

CREATE FUNCTION assessment.repin_exam_item(
    p_event_id uuid,
    p_tenant_id uuid,
    p_exam_version_id uuid,
    p_item_id uuid,
    p_question_id uuid,
    p_question_version_id uuid,
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
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, assessment, authz, app, extensions
AS $function$
DECLARE
    item_row assessment.exam_items%ROWTYPE;
    version_row assessment.exam_versions%ROWTYPE;
    actor_id uuid;
    assignment_record RECORD;
    resent integer := 0;
BEGIN
    IF NOT authz.current_context_allows(p_tenant_id, 'assessment.write', 'assessment.exam_items') THEN
        RAISE EXCEPTION 'authorization denied' USING ERRCODE = '42501';
    END IF;
    actor_id := authz.current_context_actor_id();
    SELECT * INTO item_row FROM assessment.exam_items
    WHERE tenant_id = p_tenant_id AND id = p_item_id AND exam_version_id = p_exam_version_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'exam item was not found' USING ERRCODE = 'P0002';
    END IF;
    IF item_row.kind <> 'coding' OR item_row.question_id <> p_question_id THEN
        RAISE EXCEPTION 'an item can only take another version of its own coding question' USING ERRCODE = '22023';
    END IF;
    IF item_row.question_version_id = p_question_version_id THEN
        RAISE EXCEPTION 'the item already uses this version' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO version_row FROM assessment.exam_versions
    WHERE tenant_id = p_tenant_id AND id = p_exam_version_id;
    PERFORM set_config('assessment.repinning_item', p_item_id::text, true);
    UPDATE assessment.exam_items
    SET question_version_id = p_question_version_id,
        evaluation_bundle_object_key = p_evaluation_bundle_object_key,
        evaluation_bundle_checksum = lower(p_evaluation_bundle_checksum),
        evaluation_bundle_key_reference = p_evaluation_bundle_key_reference,
        sample_bundle_object_key = p_sample_bundle_object_key,
        sample_bundle_checksum = lower(p_sample_bundle_checksum),
        sample_bundle_key_reference = p_sample_bundle_key_reference,
        time_limit_ms = p_time_limit_ms,
        memory_limit_kib = p_memory_limit_kib,
        supported_languages = p_supported_languages,
        question_title = p_question_title,
        prompt_markdown = p_prompt_markdown
    WHERE tenant_id = p_tenant_id AND id = p_item_id;
    PERFORM set_config('assessment.repinning_item', '', true);

    INSERT INTO assessment.exam_events (id, tenant_id, exam_id, exam_version_id, actor_id, event_type, payload)
    VALUES (p_event_id, p_tenant_id, version_row.exam_id, p_exam_version_id, actor_id,
            'assessment.exam_item.repinned.v1',
            jsonb_build_object('exam_item_id', p_item_id, 'from_question_version_id', item_row.question_version_id,
                               'to_question_version_id', p_question_version_id));

    IF version_row.status = 'published' THEN
        FOR assignment_record IN
            SELECT id FROM assessment.candidate_assignments
            WHERE tenant_id = p_tenant_id AND exam_version_id = p_exam_version_id
            FOR UPDATE
        LOOP
            UPDATE assessment.candidate_assignments SET version = version + 1
            WHERE tenant_id = p_tenant_id AND id = assignment_record.id;
            PERFORM assessment.enqueue_candidate_assignment_snapshot(extensions.uuid_generate_v7(), p_tenant_id, assignment_record.id);
            resent := resent + 1;
        END LOOP;
    END IF;
    RETURN resent;
END
$function$;
REVOKE ALL ON FUNCTION assessment.repin_exam_item(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, text, integer, integer, text[], text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assessment.repin_exam_item(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, text, integer, integer, text[], text, text) TO aether_assessment_app;

RESET ROLE;
