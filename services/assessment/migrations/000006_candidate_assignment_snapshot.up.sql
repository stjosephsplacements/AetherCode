-- Expand immutable assessment snapshots with the data Submission needs to
-- admit and grade an attempt without reading Assessment tables. Existing
-- pre-release exam items remain readable; a controlled backfill must populate
-- their object keys before they are materialized into new assignments.
SET ROLE aether_assessment_owner;

ALTER TABLE assessment.exam_versions
    ADD COLUMN attempt_limit integer NOT NULL DEFAULT 1 CHECK (attempt_limit BETWEEN 1 AND 20);
ALTER TABLE assessment.exam_versions ALTER COLUMN attempt_limit DROP DEFAULT;

ALTER TABLE assessment.exam_items
    ADD COLUMN evaluation_bundle_object_key text
    CHECK (
        evaluation_bundle_object_key IS NULL
        OR (
            length(evaluation_bundle_object_key) BETWEEN 1 AND 1024
            AND evaluation_bundle_object_key ~ '^[A-Za-z0-9][A-Za-z0-9._/=@+-]*$'
            AND evaluation_bundle_object_key !~ '(^|/)\.\.(/|$)'
        )
    );

-- Keep the previous routines installed (but not executable by the app role)
-- so the paired rollback restores the exact prior database contract.
REVOKE EXECUTE ON FUNCTION assessment.add_exam_item(
    uuid, uuid, uuid, uuid, bigint, integer, uuid, uuid, numeric, text
) FROM aether_assessment_app;
REVOKE EXECUTE ON FUNCTION assessment.materialize_direct_candidate_assignment(uuid, uuid, uuid, uuid)
    FROM aether_assessment_app;

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
    p_evaluation_bundle_checksum text
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
       OR p_evaluation_bundle_checksum !~* '^[0-9a-f]{64}$' THEN
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
        maximum_score, evaluation_bundle_object_key, evaluation_bundle_checksum
    ) VALUES (
        p_id, p_tenant_id, p_exam_version_id, p_section_id, p_position, p_question_id, p_question_version_id,
        p_maximum_score, p_evaluation_bundle_object_key, p_evaluation_bundle_checksum
    );
    UPDATE assessment.exam_versions
    SET content_version = content_version + 1
    WHERE id = p_exam_version_id AND tenant_id = p_tenant_id;
END
$function$;

CREATE FUNCTION assessment.materialize_direct_candidate_assignment(
    p_id uuid,
    p_tenant_id uuid,
    p_assignment_rule_id uuid,
    p_candidate_id uuid,
    p_event_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, assessment, authz, app, extensions
AS $function$
DECLARE
    rule_row assessment.assignment_rules%ROWTYPE;
    version_row assessment.exam_versions%ROWTYPE;
    candidate_state text;
    candidate_version bigint;
    item_snapshots jsonb;
    item_count integer;
    snapshot_payload jsonb;
BEGIN
    IF p_id IS NULL OR p_tenant_id IS NULL OR p_assignment_rule_id IS NULL
       OR p_candidate_id IS NULL OR p_event_id IS NULL THEN
        RAISE EXCEPTION 'candidate assignment identifiers are required' USING ERRCODE = '22023';
    END IF;
    IF NOT authz.current_context_allows(p_tenant_id, 'assessment.write', 'assessment.candidate_assignments') THEN
        RAISE EXCEPTION 'authorization denied' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO rule_row
    FROM assessment.assignment_rules
    WHERE id = p_assignment_rule_id AND tenant_id = p_tenant_id
    FOR KEY SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'assignment rule was not found' USING ERRCODE = 'P0002';
    END IF;
    IF rule_row.disabled_at IS NOT NULL THEN
        RAISE EXCEPTION 'assignment rule is disabled' USING ERRCODE = '40001';
    END IF;
    IF rule_row.target_type <> 'student' OR rule_row.target_id <> p_candidate_id THEN
        RAISE EXCEPTION 'only the rule target student can be materialized directly' USING ERRCODE = '22023';
    END IF;
    IF rule_row.available_until <= clock_timestamp() THEN
        RAISE EXCEPTION 'expired assignment rule cannot be materialized' USING ERRCODE = '40001';
    END IF;
    SELECT * INTO version_row
    FROM assessment.exam_versions
    WHERE id = rule_row.exam_version_id AND tenant_id = p_tenant_id
    FOR KEY SHARE;
    IF NOT FOUND OR version_row.status <> 'published' THEN
        RAISE EXCEPTION 'published exam version was not found' USING ERRCODE = '40001';
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
                   'maximum_score', item.maximum_score
               ) AS item_snapshot
        FROM assessment.exam_sections AS section
        JOIN assessment.exam_items AS item
          ON item.tenant_id = section.tenant_id
         AND item.exam_version_id = section.exam_version_id
         AND item.section_id = section.id
        WHERE section.tenant_id = p_tenant_id
          AND section.exam_version_id = rule_row.exam_version_id
        ORDER BY section.position, item.position
    ) AS ordered_item;
    IF item_count < 1 OR EXISTS (
        SELECT 1 FROM assessment.exam_items
        WHERE tenant_id = p_tenant_id
          AND exam_version_id = rule_row.exam_version_id
          AND evaluation_bundle_object_key IS NULL
    ) THEN
        RAISE EXCEPTION 'published exam version lacks a durable evaluation bundle snapshot' USING ERRCODE = '22023';
    END IF;

    INSERT INTO assessment.candidate_assignments (
        id, tenant_id, assignment_rule_id, exam_version_id, candidate_id, available_from, available_until
    ) VALUES (
        p_id, p_tenant_id, rule_row.id, rule_row.exam_version_id, p_candidate_id,
        rule_row.available_from, rule_row.available_until
    ) RETURNING lifecycle_state, version INTO candidate_state, candidate_version;

    snapshot_payload := jsonb_build_object(
        'tenant_id', p_tenant_id::text,
        'candidate_assignment_id', p_id::text,
        'candidate_id', p_candidate_id::text,
        'exam_id', version_row.exam_id::text,
        'exam_version_id', version_row.id::text,
        'available_from', to_char(rule_row.available_from AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'available_until', to_char(rule_row.available_until AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'attempt_limit', version_row.attempt_limit,
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
        p_event_id, p_tenant_id, 'candidate_assignment', p_id,
        'assessment.candidate_assignment.snapshot.v1', 1,
        snapshot_payload, extensions.digest(convert_to(snapshot_payload::text, 'UTF8'), 'sha256'),
        clock_timestamp(), clock_timestamp()
    );
END
$function$;

REVOKE ALL ON FUNCTION assessment.add_exam_item(
    uuid, uuid, uuid, uuid, bigint, integer, uuid, uuid, numeric, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION assessment.materialize_direct_candidate_assignment(uuid, uuid, uuid, uuid, uuid)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assessment.add_exam_item(
    uuid, uuid, uuid, uuid, bigint, integer, uuid, uuid, numeric, text, text
) TO aether_assessment_app;
GRANT EXECUTE ON FUNCTION assessment.materialize_direct_candidate_assignment(uuid, uuid, uuid, uuid, uuid)
    TO aether_assessment_app;

RESET ROLE;
