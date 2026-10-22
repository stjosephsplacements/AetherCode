-- Exams assigned to a placement department reach its students (ADR-0026).
-- User's batch affiliation snapshot now names the student's placement
-- department; the roster keeps it, the per-student materializer matches
-- placement_department rules, and a new placement rule backfills its students.
SET ROLE aether_assessment_owner;

ALTER TABLE assessment.student_batch_enrollments ADD COLUMN placement_department_id uuid;
CREATE INDEX student_batch_enrollments_placement_idx
    ON assessment.student_batch_enrollments (tenant_id, placement_department_id)
    WHERE status = 'active' AND placement_department_id IS NOT NULL;

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

DROP FUNCTION assessment.materialize_from_batch_affiliation(uuid, uuid, uuid, uuid, uuid, text, bigint);

CREATE FUNCTION assessment.materialize_from_batch_affiliation(
    p_event_id uuid,
    p_tenant_id uuid,
    p_student_id uuid,
    p_principal_id uuid,
    p_batch_id uuid,
    p_lifecycle_state text,
    p_version bigint,
    p_placement_department_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, assessment, app, extensions
AS $function$
BEGIN
    IF p_event_id IS NULL OR p_tenant_id IS NULL OR p_student_id IS NULL OR p_principal_id IS NULL
       OR p_lifecycle_state NOT IN ('active', 'inactive') OR p_version IS NULL OR p_version < 1
       OR (p_lifecycle_state = 'active' AND p_batch_id IS NULL) THEN
        RAISE EXCEPTION 'batch affiliation materialization identifiers are required' USING ERRCODE = '22023';
    END IF;

    -- The roster keeps only the newest affiliation; a redelivered or
    -- out-of-order older snapshot changes nothing.
    INSERT INTO assessment.student_batch_enrollments AS enrollment (
        tenant_id, student_id, principal_id, batch_id, status, affiliation_version, placement_department_id
    ) VALUES (
        p_tenant_id, p_student_id, p_principal_id, p_batch_id,
        p_lifecycle_state, p_version, p_placement_department_id
    ) ON CONFLICT (tenant_id, student_id) DO UPDATE
    SET principal_id = EXCLUDED.principal_id,
        batch_id = CASE WHEN EXCLUDED.status = 'active' THEN EXCLUDED.batch_id ELSE enrollment.batch_id END,
        status = EXCLUDED.status,
        affiliation_version = EXCLUDED.affiliation_version,
        placement_department_id = COALESCE(EXCLUDED.placement_department_id, enrollment.placement_department_id),
        updated_at = clock_timestamp()
    WHERE EXCLUDED.affiliation_version > enrollment.affiliation_version;

    IF p_lifecycle_state = 'active' THEN
        PERFORM assessment.materialize_candidate(p_tenant_id, p_principal_id, p_batch_id);
    END IF;
END
$function$;

REVOKE ALL ON FUNCTION assessment.materialize_from_batch_affiliation(uuid, uuid, uuid, uuid, uuid, text, bigint, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assessment.materialize_from_batch_affiliation(uuid, uuid, uuid, uuid, uuid, text, bigint, uuid)
    TO aether_assessment_projection_worker;

CREATE OR REPLACE FUNCTION assessment.backfill_from_assignment_rule(
    p_event_id uuid,
    p_tenant_id uuid,
    p_assignment_rule_id uuid,
    p_target_type text,
    p_target_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, assessment, app, extensions
AS $function$
DECLARE
    student_record RECORD;
BEGIN
    IF p_event_id IS NULL OR p_tenant_id IS NULL OR p_assignment_rule_id IS NULL
       OR p_target_type IS NULL OR p_target_id IS NULL THEN
        RAISE EXCEPTION 'backfill identifiers are required' USING ERRCODE = '22023';
    END IF;

    -- Student targets are materialized directly. Placement department targets
    -- use the placement department each student's affiliation snapshot names.
    IF p_target_type NOT IN ('batch', 'department', 'placement_department') THEN
        RETURN;
    END IF;

    -- Find all students in the target scope who don't yet have an assignment
    -- from this rule, then call materialize_from_enrollment for each.
    FOR student_record IN
        SELECT DISTINCT sbe.principal_id, sbe.batch_id
        FROM assessment.student_batch_enrollments AS sbe
        WHERE sbe.tenant_id = p_tenant_id
          AND sbe.status = 'active'
          AND sbe.principal_id IS NOT NULL
          AND (
              (p_target_type = 'batch' AND sbe.batch_id = p_target_id)
              OR (p_target_type = 'department' AND sbe.batch_id IN (
                  SELECT bdp.batch_id
                  FROM assessment.batch_department_projections AS bdp
                  WHERE bdp.tenant_id = p_tenant_id
                    AND bdp.department_id = p_target_id
                    AND bdp.status = 'active'
              ))
              OR (p_target_type = 'placement_department' AND sbe.placement_department_id = p_target_id)
          )
    LOOP
        -- materialize_candidate skips rules the student already has.
        PERFORM assessment.materialize_candidate(p_tenant_id, student_record.principal_id, student_record.batch_id);
    END LOOP;
END
$function$;

RESET ROLE;
