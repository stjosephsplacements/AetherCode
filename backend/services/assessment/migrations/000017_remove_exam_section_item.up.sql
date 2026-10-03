-- Exam authors can add sections/items to a draft exam version but had no way
-- to remove them. Mirror add_exam_section/add_exam_item's validation shape
-- (draft-only, optimistic-concurrency content_version check, authz check) but
-- delete instead of insert. exam_items.section_id already carries an
-- ON DELETE RESTRICT foreign key to exam_sections, so the database already
-- refuses to delete a section that still has items; the explicit check below
-- is kept anyway so callers get the same readable, application-level error
-- message convention as every other validation failure in this file instead
-- of a raw foreign-key-violation message, per ADR-0013's no-silent-cascade
-- posture.
SET ROLE aether_assessment_owner;

CREATE FUNCTION assessment.remove_exam_section(
    p_id uuid,
    p_tenant_id uuid,
    p_exam_version_id uuid,
    p_expected_content_version bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, assessment, authz
AS $function$
DECLARE version_row assessment.exam_versions%ROWTYPE;
BEGIN
    IF p_id IS NULL OR p_tenant_id IS NULL OR p_exam_version_id IS NULL
       OR p_expected_content_version IS NULL OR p_expected_content_version <= 0 THEN
        RAISE EXCEPTION 'invalid exam section removal command' USING ERRCODE = '22023';
    END IF;
    IF NOT authz.current_context_allows(p_tenant_id, 'assessment.write', 'assessment.exam_sections') THEN
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
        WHERE id = p_id AND tenant_id = p_tenant_id AND exam_version_id = p_exam_version_id
    ) THEN
        RAISE EXCEPTION 'exam section was not found' USING ERRCODE = 'P0002';
    END IF;
    IF EXISTS (
        SELECT 1 FROM assessment.exam_items
        WHERE section_id = p_id AND tenant_id = p_tenant_id
    ) THEN
        RAISE EXCEPTION 'exam section still has items; remove them first' USING ERRCODE = '23503';
    END IF;

    DELETE FROM assessment.exam_sections WHERE id = p_id AND tenant_id = p_tenant_id;
    UPDATE assessment.exam_versions
    SET content_version = content_version + 1
    WHERE id = p_exam_version_id AND tenant_id = p_tenant_id;
END
$function$;

CREATE FUNCTION assessment.remove_exam_item(
    p_id uuid,
    p_tenant_id uuid,
    p_exam_version_id uuid,
    p_expected_content_version bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, assessment, authz
AS $function$
DECLARE version_row assessment.exam_versions%ROWTYPE;
BEGIN
    IF p_id IS NULL OR p_tenant_id IS NULL OR p_exam_version_id IS NULL
       OR p_expected_content_version IS NULL OR p_expected_content_version <= 0 THEN
        RAISE EXCEPTION 'invalid exam item removal command' USING ERRCODE = '22023';
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
        SELECT 1 FROM assessment.exam_items
        WHERE id = p_id AND tenant_id = p_tenant_id AND exam_version_id = p_exam_version_id
    ) THEN
        RAISE EXCEPTION 'exam item was not found' USING ERRCODE = 'P0002';
    END IF;

    DELETE FROM assessment.exam_items WHERE id = p_id AND tenant_id = p_tenant_id;
    UPDATE assessment.exam_versions
    SET content_version = content_version + 1
    WHERE id = p_exam_version_id AND tenant_id = p_tenant_id;
END
$function$;

REVOKE ALL ON FUNCTION assessment.remove_exam_section(uuid, uuid, uuid, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION assessment.remove_exam_item(uuid, uuid, uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assessment.remove_exam_section(uuid, uuid, uuid, bigint) TO aether_assessment_app;
GRANT EXECUTE ON FUNCTION assessment.remove_exam_item(uuid, uuid, uuid, bigint) TO aether_assessment_app;

RESET ROLE;
