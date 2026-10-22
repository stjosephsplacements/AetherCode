-- The exam list carries each exam's latest version, so a page lists exams in
-- one request instead of one per exam (ADR-0043). A college with 70 exams
-- exceeded the gateway's per-user burst. Readers of exams may read this
-- metadata; it is what they would get version by version.
SET ROLE aether_assessment_owner;

CREATE FUNCTION assessment.latest_exam_versions(p_tenant_id uuid, p_exam_ids uuid[])
RETURNS TABLE (
    out_id uuid, out_exam_id uuid, out_version_number integer, out_content_version bigint, out_attempt_limit integer,
    out_title text, out_instructions_markdown text, out_opens_at timestamptz, out_closes_at timestamptz,
    out_duration_seconds integer, out_proctor_policy_version_id uuid, out_status text, out_published_at timestamptz,
    out_created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, assessment, authz
AS $function$
BEGIN
    IF NOT authz.current_context_allows_read(p_tenant_id, 'assessment.read', 'assessment.write', 'assessment.exams') THEN
        RAISE EXCEPTION 'signed authorization context does not allow reading exams' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
    SELECT DISTINCT ON (version.exam_id)
           version.id, version.exam_id, version.version_number, version.content_version::bigint, version.attempt_limit,
           version.title, version.instructions_markdown, version.opens_at, version.closes_at, version.duration_seconds,
           version.proctor_policy_version_id, version.status, version.published_at, version.created_at
    FROM assessment.exam_versions AS version
    WHERE version.tenant_id = p_tenant_id
      AND version.exam_id = ANY(p_exam_ids)
      AND version.deleted_at IS NULL
    ORDER BY version.exam_id, version.version_number DESC, version.id DESC;
END
$function$;

REVOKE ALL ON FUNCTION assessment.latest_exam_versions(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assessment.latest_exam_versions(uuid, uuid[]) TO aether_assessment_app;

RESET ROLE;
