-- Candidate assignment lifecycle updates are emitted as full immutable
-- snapshots so Submission and User can converge without cross-database reads.
SET ROLE aether_assessment_owner;

-- The deliberately narrow create_exam_version routine owns the insert. Its
-- immutable initial counters therefore need database defaults rather than
-- caller-controlled values.
ALTER TABLE assessment.exam_versions ALTER COLUMN content_version SET DEFAULT 1;
ALTER TABLE assessment.exam_versions ALTER COLUMN attempt_limit SET DEFAULT 1;

CREATE FUNCTION assessment.enqueue_candidate_assignment_snapshot(
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
                'maximum_score', item.maximum_score
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

-- Replace the first snapshot emitter with a shared routine. This also
-- normalizes historical checksums to lowercase at the event boundary.
CREATE OR REPLACE FUNCTION assessment.materialize_direct_candidate_assignment(
    p_id uuid,
    p_tenant_id uuid,
    p_assignment_rule_id uuid,
    p_candidate_id uuid,
    p_event_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, assessment, authz
AS $function$
DECLARE
    rule_row assessment.assignment_rules%ROWTYPE;
    version_row assessment.exam_versions%ROWTYPE;
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
    FOR UPDATE;
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

    INSERT INTO assessment.candidate_assignments (
        id, tenant_id, assignment_rule_id, exam_version_id, candidate_id, available_from, available_until
    ) VALUES (
        p_id, p_tenant_id, rule_row.id, rule_row.exam_version_id, p_candidate_id,
        rule_row.available_from, rule_row.available_until
    );
    PERFORM assessment.enqueue_candidate_assignment_snapshot(p_event_id, p_tenant_id, p_id);
END
$function$;

CREATE FUNCTION assessment.revoke_candidate_assignment(
    p_tenant_id uuid,
    p_candidate_assignment_id uuid,
    p_expected_version bigint,
    p_event_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, assessment, authz
AS $function$
DECLARE
    assignment_row assessment.candidate_assignments%ROWTYPE;
BEGIN
    IF p_tenant_id IS NULL OR p_candidate_assignment_id IS NULL
       OR p_expected_version IS NULL OR p_expected_version <= 0 OR p_event_id IS NULL THEN
        RAISE EXCEPTION 'candidate assignment revocation identifiers are required' USING ERRCODE = '22023';
    END IF;
    IF NOT authz.current_context_allows(p_tenant_id, 'assessment.write', 'assessment.candidate_assignments') THEN
        RAISE EXCEPTION 'authorization denied' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO assignment_row
    FROM assessment.candidate_assignments
    WHERE id = p_candidate_assignment_id AND tenant_id = p_tenant_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'candidate assignment was not found' USING ERRCODE = 'P0002';
    END IF;
    IF assignment_row.version <> p_expected_version THEN
        RAISE EXCEPTION 'candidate assignment version is stale' USING ERRCODE = '40001';
    END IF;
    IF assignment_row.lifecycle_state <> 'assigned' THEN
        RAISE EXCEPTION 'candidate assignment is no longer revocable' USING ERRCODE = '40001';
    END IF;

    UPDATE assessment.candidate_assignments
    SET lifecycle_state = 'revoked',
        revoked_at = clock_timestamp(),
        version = version + 1
    WHERE id = p_candidate_assignment_id AND tenant_id = p_tenant_id;

    PERFORM assessment.enqueue_candidate_assignment_snapshot(p_event_id, p_tenant_id, p_candidate_assignment_id);
END
$function$;

REVOKE ALL ON FUNCTION assessment.enqueue_candidate_assignment_snapshot(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION assessment.materialize_direct_candidate_assignment(uuid, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION assessment.revoke_candidate_assignment(uuid, uuid, bigint, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assessment.materialize_direct_candidate_assignment(uuid, uuid, uuid, uuid, uuid)
    TO aether_assessment_app;
GRANT EXECUTE ON FUNCTION assessment.revoke_candidate_assignment(uuid, uuid, bigint, uuid)
    TO aether_assessment_app;

RESET ROLE;
