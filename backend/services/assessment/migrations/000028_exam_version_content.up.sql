SET ROLE aether_assessment_owner;

-- The staff exam builder reads an exam version's sections, items and
-- assignment rules in one call. RLS binds a request to one resource, so this
-- reader accepts the exam_versions capability the version read already uses.
CREATE FUNCTION assessment.get_exam_version_content(p_tenant_id uuid, p_exam_version_id uuid)
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

REVOKE ALL ON FUNCTION assessment.get_exam_version_content(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assessment.get_exam_version_content(uuid, uuid) TO aether_assessment_app;

RESET ROLE;
