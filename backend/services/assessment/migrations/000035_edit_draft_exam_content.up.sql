-- Editing a draft exam (ADR-0054).
--
-- Draft exams could gain and lose sections and questions but not be changed: the
-- title, instructions, window and duration, a section's title and time limit, and
-- a question's marks were fixed once saved. These functions mirror
-- remove_exam_section: draft only, optimistic content_version check, authz check,
-- and a content_version bump. NULL means leave the field as it is.
SET ROLE aether_assessment_owner;

CREATE FUNCTION assessment.update_exam_version(
    p_id uuid,
    p_tenant_id uuid,
    p_expected_content_version bigint,
    p_title text,
    p_instructions_markdown text,
    p_opens_at timestamptz,
    p_closes_at timestamptz,
    p_duration_seconds integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, assessment, authz
AS $function$
DECLARE version_row assessment.exam_versions%ROWTYPE;
BEGIN
    IF p_id IS NULL OR p_tenant_id IS NULL OR p_expected_content_version IS NULL OR p_expected_content_version <= 0
       OR (p_title IS NULL AND p_instructions_markdown IS NULL AND p_opens_at IS NULL AND p_closes_at IS NULL AND p_duration_seconds IS NULL)
       OR (p_title IS NOT NULL AND char_length(btrim(p_title)) NOT BETWEEN 1 AND 300)
       OR (p_instructions_markdown IS NOT NULL AND char_length(btrim(p_instructions_markdown)) < 1)
       OR (p_duration_seconds IS NOT NULL AND p_duration_seconds NOT BETWEEN 60 AND 43200) THEN
        RAISE EXCEPTION 'invalid exam version update' USING ERRCODE = '22023';
    END IF;
    IF NOT authz.current_context_allows(p_tenant_id, 'assessment.write', 'assessment.exam_versions') THEN
        RAISE EXCEPTION 'authorization denied' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO version_row FROM assessment.exam_versions WHERE id = p_id AND tenant_id = p_tenant_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'exam version was not found' USING ERRCODE = 'P0002';
    END IF;
    IF version_row.status <> 'draft' THEN
        RAISE EXCEPTION 'published exam version is immutable' USING ERRCODE = '40001';
    END IF;
    IF version_row.content_version <> p_expected_content_version THEN
        RAISE EXCEPTION 'exam content version is stale' USING ERRCODE = '40001';
    END IF;
    IF COALESCE(p_opens_at, version_row.opens_at) >= COALESCE(p_closes_at, version_row.closes_at) THEN
        RAISE EXCEPTION 'the exam must open before it closes' USING ERRCODE = '22023';
    END IF;
    UPDATE assessment.exam_versions
    SET title = COALESCE(btrim(p_title), title),
        instructions_markdown = COALESCE(btrim(p_instructions_markdown), instructions_markdown),
        opens_at = COALESCE(p_opens_at, opens_at),
        closes_at = COALESCE(p_closes_at, closes_at),
        duration_seconds = COALESCE(p_duration_seconds, duration_seconds),
        content_version = content_version + 1
    WHERE id = p_id AND tenant_id = p_tenant_id;
END
$function$;

CREATE FUNCTION assessment.update_exam_section(
    p_id uuid,
    p_tenant_id uuid,
    p_exam_version_id uuid,
    p_expected_content_version bigint,
    p_title text,
    p_instructions_markdown text,
    p_time_limit_seconds integer,
    p_clear_time_limit boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, assessment, authz
AS $function$
DECLARE version_row assessment.exam_versions%ROWTYPE;
BEGIN
    IF p_id IS NULL OR p_tenant_id IS NULL OR p_exam_version_id IS NULL OR p_expected_content_version IS NULL OR p_expected_content_version <= 0
       OR (p_title IS NULL AND p_instructions_markdown IS NULL AND p_time_limit_seconds IS NULL AND NOT COALESCE(p_clear_time_limit, false))
       OR (p_title IS NOT NULL AND char_length(btrim(p_title)) NOT BETWEEN 1 AND 300)
       OR (p_time_limit_seconds IS NOT NULL AND p_time_limit_seconds NOT BETWEEN 60 AND 43200)
       OR (p_time_limit_seconds IS NOT NULL AND COALESCE(p_clear_time_limit, false)) THEN
        RAISE EXCEPTION 'invalid exam section update' USING ERRCODE = '22023';
    END IF;
    IF NOT authz.current_context_allows(p_tenant_id, 'assessment.write', 'assessment.exam_sections') THEN
        RAISE EXCEPTION 'authorization denied' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO version_row FROM assessment.exam_versions WHERE id = p_exam_version_id AND tenant_id = p_tenant_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'exam version was not found' USING ERRCODE = 'P0002';
    END IF;
    IF version_row.status <> 'draft' THEN
        RAISE EXCEPTION 'published exam version is immutable' USING ERRCODE = '40001';
    END IF;
    IF version_row.content_version <> p_expected_content_version THEN
        RAISE EXCEPTION 'exam content version is stale' USING ERRCODE = '40001';
    END IF;
    UPDATE assessment.exam_sections
    SET title = COALESCE(btrim(p_title), title),
        instructions_markdown = COALESCE(btrim(p_instructions_markdown), instructions_markdown),
        time_limit_seconds = CASE WHEN COALESCE(p_clear_time_limit, false) THEN NULL ELSE COALESCE(p_time_limit_seconds, time_limit_seconds) END
    WHERE id = p_id AND tenant_id = p_tenant_id AND exam_version_id = p_exam_version_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'exam section was not found' USING ERRCODE = 'P0002';
    END IF;
    UPDATE assessment.exam_versions SET content_version = content_version + 1 WHERE id = p_exam_version_id AND tenant_id = p_tenant_id;
END
$function$;

CREATE FUNCTION assessment.update_exam_item(
    p_id uuid,
    p_tenant_id uuid,
    p_exam_version_id uuid,
    p_expected_content_version bigint,
    p_maximum_score numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, assessment, authz
AS $function$
DECLARE version_row assessment.exam_versions%ROWTYPE;
BEGIN
    IF p_id IS NULL OR p_tenant_id IS NULL OR p_exam_version_id IS NULL OR p_expected_content_version IS NULL OR p_expected_content_version <= 0
       OR p_maximum_score IS NULL OR p_maximum_score <= 0 OR p_maximum_score >= 100000000 THEN
        RAISE EXCEPTION 'invalid exam item update' USING ERRCODE = '22023';
    END IF;
    IF NOT authz.current_context_allows(p_tenant_id, 'assessment.write', 'assessment.exam_items') THEN
        RAISE EXCEPTION 'authorization denied' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO version_row FROM assessment.exam_versions WHERE id = p_exam_version_id AND tenant_id = p_tenant_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'exam version was not found' USING ERRCODE = 'P0002';
    END IF;
    IF version_row.status <> 'draft' THEN
        RAISE EXCEPTION 'published exam version is immutable' USING ERRCODE = '40001';
    END IF;
    IF version_row.content_version <> p_expected_content_version THEN
        RAISE EXCEPTION 'exam content version is stale' USING ERRCODE = '40001';
    END IF;
    UPDATE assessment.exam_items SET maximum_score = p_maximum_score
    WHERE id = p_id AND tenant_id = p_tenant_id AND exam_version_id = p_exam_version_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'exam item was not found' USING ERRCODE = 'P0002';
    END IF;
    UPDATE assessment.exam_versions SET content_version = content_version + 1 WHERE id = p_exam_version_id AND tenant_id = p_tenant_id;
END
$function$;

REVOKE ALL ON FUNCTION assessment.update_exam_version(uuid, uuid, bigint, text, text, timestamptz, timestamptz, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION assessment.update_exam_section(uuid, uuid, uuid, bigint, text, text, integer, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION assessment.update_exam_item(uuid, uuid, uuid, bigint, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assessment.update_exam_version(uuid, uuid, bigint, text, text, timestamptz, timestamptz, integer) TO aether_assessment_app;
GRANT EXECUTE ON FUNCTION assessment.update_exam_section(uuid, uuid, uuid, bigint, text, text, integer, boolean) TO aether_assessment_app;
GRANT EXECUTE ON FUNCTION assessment.update_exam_item(uuid, uuid, uuid, bigint, numeric) TO aether_assessment_app;

RESET ROLE;
