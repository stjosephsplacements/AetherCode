SET ROLE aether_assessment_owner;

-- Restore the 000006 materializer before dropping the private helper it now
-- calls, so a rollback remains executable at every step.
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

REVOKE EXECUTE ON FUNCTION assessment.revoke_candidate_assignment(uuid, uuid, bigint, uuid)
    FROM aether_assessment_app;
DROP FUNCTION assessment.revoke_candidate_assignment(uuid, uuid, bigint, uuid);
DROP FUNCTION assessment.enqueue_candidate_assignment_snapshot(uuid, uuid, uuid);

ALTER TABLE assessment.exam_versions ALTER COLUMN attempt_limit DROP DEFAULT;
ALTER TABLE assessment.exam_versions ALTER COLUMN content_version DROP DEFAULT;

RESET ROLE;
