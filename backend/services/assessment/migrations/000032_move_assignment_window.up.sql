-- Moving an assignment's window after publication (ADR-0040), the exam app's
-- "push the exam window back": staff move a rule's close time, its
-- assignments follow, and each is snapshotted again so Submission lets late
-- students start and SEB keeps the lock on until the new close.
SET ROLE aether_assessment_owner;

CREATE FUNCTION assessment.move_assignment_window(
    p_event_id uuid,
    p_tenant_id uuid,
    p_assignment_rule_id uuid,
    p_available_until timestamptz
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, assessment, authz, app, extensions
AS $function$
DECLARE
    rule_row assessment.assignment_rules%ROWTYPE;
    version_row assessment.exam_versions%ROWTYPE;
    assignment_record RECORD;
    moved integer := 0;
BEGIN
    IF NOT authz.current_context_allows(p_tenant_id, 'assessment.write', 'assessment.assignment_rules') THEN
        RAISE EXCEPTION 'authorization denied' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO rule_row FROM assessment.assignment_rules
    WHERE tenant_id = p_tenant_id AND id = p_assignment_rule_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'assignment rule was not found' USING ERRCODE = 'P0002';
    END IF;
    IF p_available_until IS NULL OR p_available_until <= rule_row.available_from
       OR p_available_until <= clock_timestamp()
       OR p_available_until > rule_row.available_from + interval '30 days' THEN
        RAISE EXCEPTION 'the window must close after it opens, in the future, within 30 days' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO version_row FROM assessment.exam_versions
    WHERE tenant_id = p_tenant_id AND id = rule_row.exam_version_id;

    UPDATE assessment.assignment_rules SET available_until = p_available_until
    WHERE tenant_id = p_tenant_id AND id = p_assignment_rule_id;
    INSERT INTO assessment.exam_events (id, tenant_id, exam_id, exam_version_id, actor_id, event_type, payload)
    VALUES (p_event_id, p_tenant_id, version_row.exam_id, rule_row.exam_version_id, authz.current_context_actor_id(),
            'assessment.assignment_rule.window_moved.v1',
            jsonb_build_object('assignment_rule_id', p_assignment_rule_id,
                               'from', rule_row.available_until, 'to', p_available_until));

    FOR assignment_record IN
        SELECT id FROM assessment.candidate_assignments
        WHERE tenant_id = p_tenant_id AND assignment_rule_id = p_assignment_rule_id AND lifecycle_state <> 'revoked'
        FOR UPDATE
    LOOP
        UPDATE assessment.candidate_assignments
        SET available_until = p_available_until, version = version + 1
        WHERE tenant_id = p_tenant_id AND id = assignment_record.id;
        PERFORM assessment.enqueue_candidate_assignment_snapshot(extensions.uuid_generate_v7(), p_tenant_id, assignment_record.id);
        moved := moved + 1;
    END LOOP;
    RETURN moved;
END
$function$;
REVOKE ALL ON FUNCTION assessment.move_assignment_window(uuid, uuid, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assessment.move_assignment_window(uuid, uuid, uuid, timestamptz) TO aether_assessment_app;

RESET ROLE;
