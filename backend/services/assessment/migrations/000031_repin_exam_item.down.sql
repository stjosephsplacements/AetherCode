SET ROLE aether_assessment_owner;

CREATE OR REPLACE FUNCTION assessment.reject_published_exam_child_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, assessment
AS $$
BEGIN
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

DROP FUNCTION assessment.repin_exam_item(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, text, integer, integer, text[], text, text);

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

RESET ROLE;
