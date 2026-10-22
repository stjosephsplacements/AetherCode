-- Question pools (ADR-0034). A section may draw draw_count of its questions
-- for each student instead of giving everyone all of them. The draw ranks a
-- section's items by md5(candidate || item) and keeps the first draw_count:
-- different students get different questions, and a student's draw never
-- changes when their assignment is snapshotted again. Publication requires a
-- pool to hold at least draw_count items, all with the same maximum score.
SET ROLE aether_assessment_owner;

ALTER TABLE assessment.exam_sections
    ADD COLUMN draw_count integer CHECK (draw_count IS NULL OR draw_count BETWEEN 1 AND 100);

CREATE FUNCTION assessment.item_drawn(
    p_tenant_id uuid, p_section_id uuid, p_draw_count integer, p_candidate_id uuid, p_item_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, assessment
AS $function$
    SELECT p_draw_count IS NULL OR p_item_id IN (
        SELECT item.id FROM assessment.exam_items AS item
        WHERE item.tenant_id = p_tenant_id AND item.section_id = p_section_id
        ORDER BY md5(p_candidate_id::text || item.id::text), item.id
        LIMIT p_draw_count
    )
$function$;
REVOKE ALL ON FUNCTION assessment.item_drawn(uuid, uuid, integer, uuid, uuid) FROM PUBLIC;

-- add_exam_section with a draw count; the eight-argument form stays for
-- sections every student gets in full.
CREATE FUNCTION assessment.add_exam_section(
    p_id uuid, p_tenant_id uuid, p_exam_version_id uuid, p_expected_content_version bigint,
    p_position integer, p_title text, p_instructions_markdown text, p_time_limit_seconds integer,
    p_draw_count integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, assessment, authz
AS $function$
BEGIN
    IF p_draw_count IS NOT NULL AND p_draw_count NOT BETWEEN 1 AND 100 THEN
        RAISE EXCEPTION 'a pool draws 1 to 100 questions' USING ERRCODE = '22023';
    END IF;
    PERFORM assessment.add_exam_section(p_id, p_tenant_id, p_exam_version_id, p_expected_content_version,
                                        p_position, p_title, p_instructions_markdown, p_time_limit_seconds);
    UPDATE assessment.exam_sections SET draw_count = p_draw_count
    WHERE id = p_id AND tenant_id = p_tenant_id;
END
$function$;
REVOKE ALL ON FUNCTION assessment.add_exam_section(uuid, uuid, uuid, bigint, integer, text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assessment.add_exam_section(uuid, uuid, uuid, bigint, integer, text, text, integer, integer) TO aether_assessment_app;

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
                       'prompt_markdown', item.prompt_markdown
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

CREATE OR REPLACE FUNCTION assessment.publish_exam_version(
    p_tenant_id uuid,
    p_exam_version_id uuid,
    p_expected_content_version bigint,
    p_event_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, assessment, authz
AS $function$
DECLARE version_row assessment.exam_versions%ROWTYPE;
DECLARE actor_id uuid;
BEGIN
    IF p_tenant_id IS NULL OR p_exam_version_id IS NULL OR p_event_id IS NULL
       OR p_expected_content_version IS NULL OR p_expected_content_version <= 0 THEN
        RAISE EXCEPTION 'invalid exam publication command' USING ERRCODE = '22023';
    END IF;
    IF NOT authz.current_context_allows(p_tenant_id, 'assessment.write', 'assessment.exam_versions') THEN
        RAISE EXCEPTION 'authorization denied' USING ERRCODE = '42501';
    END IF;
    actor_id := authz.current_context_actor_id();
    IF actor_id IS NULL THEN
        RAISE EXCEPTION 'authorization context is unavailable' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO version_row
    FROM assessment.exam_versions
    WHERE id = p_exam_version_id AND tenant_id = p_tenant_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'exam version was not found' USING ERRCODE = 'P0002';
    END IF;
    IF version_row.status <> 'draft' THEN
        RAISE EXCEPTION 'draft exam version was not found' USING ERRCODE = '40001';
    END IF;
    IF version_row.content_version <> p_expected_content_version THEN
        RAISE EXCEPTION 'exam content version is stale' USING ERRCODE = '40001';
    END IF;
    IF version_row.closes_at <= clock_timestamp() THEN
        RAISE EXCEPTION 'closed exam version cannot be published' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM assessment.exam_sections
        WHERE tenant_id = p_tenant_id AND exam_version_id = p_exam_version_id
    ) OR NOT EXISTS (
        SELECT 1 FROM assessment.exam_items
        WHERE tenant_id = p_tenant_id AND exam_version_id = p_exam_version_id
    ) THEN
        RAISE EXCEPTION 'exam version requires at least one section and item' USING ERRCODE = '22023';
    END IF;
    -- A pool draws some of its questions for each student; it must hold at
    -- least that many, all worth the same, so every student's total is equal.
    IF EXISTS (
        SELECT 1
        FROM assessment.exam_sections AS section
        JOIN assessment.exam_items AS item
          ON item.tenant_id = section.tenant_id AND item.section_id = section.id
        WHERE section.tenant_id = p_tenant_id
          AND section.exam_version_id = p_exam_version_id
          AND section.draw_count IS NOT NULL
        GROUP BY section.id, section.draw_count
        HAVING count(*) < section.draw_count OR count(DISTINCT item.maximum_score) > 1
    ) OR EXISTS (
        SELECT 1 FROM assessment.exam_sections AS section
        WHERE section.tenant_id = p_tenant_id AND section.exam_version_id = p_exam_version_id
          AND section.draw_count IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM assessment.exam_items AS item
                          WHERE item.tenant_id = section.tenant_id AND item.section_id = section.id)
    ) THEN
        RAISE EXCEPTION 'each pool needs at least as many questions as it draws, all worth the same marks'
            USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM assessment.proctor_policy_versions
        WHERE id = version_row.proctor_policy_version_id
          AND tenant_id = p_tenant_id AND status = 'published'
    ) THEN
        RAISE EXCEPTION 'exam version requires a published proctor policy' USING ERRCODE = '22023';
    END IF;

    UPDATE assessment.exam_versions
    SET status = 'published', published_at = clock_timestamp()
    WHERE id = p_exam_version_id AND tenant_id = p_tenant_id;
    UPDATE assessment.exams
    SET lifecycle_state = 'published', updated_at = clock_timestamp(), version = version + 1
    WHERE id = version_row.exam_id AND tenant_id = p_tenant_id AND lifecycle_state <> 'archived';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'exam was archived during publication' USING ERRCODE = '40001';
    END IF;
    INSERT INTO assessment.exam_events (
        id, tenant_id, exam_id, exam_version_id, actor_id, event_type, payload
    ) VALUES (
        p_event_id, p_tenant_id, version_row.exam_id, p_exam_version_id, actor_id,
        'assessment.exam_version.published.v1',
        jsonb_build_object(
            'exam_id', version_row.exam_id::text,
            'exam_version_id', p_exam_version_id::text,
            'version_number', version_row.version_number,
            'content_version', version_row.content_version
        )
    );
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
