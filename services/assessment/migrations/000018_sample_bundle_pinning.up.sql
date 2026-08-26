-- Let exam authors optionally pin a sample test bundle onto an exam item,
-- mirroring how the mandatory hidden evaluation bundle is already pinned.
-- Sample bundles are optional (candidate "run code" needs no sample tests to
-- exist), but when present both the object key and checksum must be present
-- together -- a half-pinned bundle is never a valid state.
SET ROLE aether_assessment_owner;

ALTER TABLE assessment.exam_items
    ADD COLUMN sample_bundle_object_key text
        CHECK (
            sample_bundle_object_key IS NULL OR (
                length(sample_bundle_object_key) BETWEEN 1 AND 1024
                AND sample_bundle_object_key ~ '^[A-Za-z0-9][A-Za-z0-9._/=@+-]*$'
                AND sample_bundle_object_key !~ '(^|/)\.\.(/|$)'
            )
        ),
    ADD COLUMN sample_bundle_checksum char(64)
        CHECK (sample_bundle_checksum IS NULL OR sample_bundle_checksum ~* '^[0-9a-f]{64}$'),
    ADD CONSTRAINT sample_bundle_pair_complete CHECK (
        (sample_bundle_object_key IS NULL) = (sample_bundle_checksum IS NULL)
    );

-- Keep the previous add_exam_item(...) overload installed (but not executable
-- by the app role) so the paired rollback restores the exact prior database
-- contract, matching the convention established when the hidden bundle was
-- added in 000006_candidate_assignment_snapshot.
REVOKE EXECUTE ON FUNCTION assessment.add_exam_item(
    uuid, uuid, uuid, uuid, bigint, integer, uuid, uuid, numeric, text, text
) FROM aether_assessment_app;

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
    p_evaluation_bundle_checksum text,
    p_sample_bundle_object_key text,
    p_sample_bundle_checksum text
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
       OR p_evaluation_bundle_checksum !~* '^[0-9a-f]{64}$'
       OR (p_sample_bundle_object_key IS NULL) <> (p_sample_bundle_checksum IS NULL)
       OR (
           p_sample_bundle_object_key IS NOT NULL AND (
               length(p_sample_bundle_object_key) NOT BETWEEN 1 AND 1024
               OR p_sample_bundle_object_key !~ '^[A-Za-z0-9][A-Za-z0-9._/=@+-]*$'
               OR p_sample_bundle_object_key ~ '(^|/)\.\.(/|$)'
           )
       )
       OR (p_sample_bundle_checksum IS NOT NULL AND p_sample_bundle_checksum !~* '^[0-9a-f]{64}$') THEN
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
        maximum_score, evaluation_bundle_object_key, evaluation_bundle_checksum,
        sample_bundle_object_key, sample_bundle_checksum
    ) VALUES (
        p_id, p_tenant_id, p_exam_version_id, p_section_id, p_position, p_question_id, p_question_version_id,
        p_maximum_score, p_evaluation_bundle_object_key, p_evaluation_bundle_checksum,
        p_sample_bundle_object_key, p_sample_bundle_checksum
    );
    UPDATE assessment.exam_versions
    SET content_version = content_version + 1
    WHERE id = p_exam_version_id AND tenant_id = p_tenant_id;
END
$function$;

REVOKE ALL ON FUNCTION assessment.add_exam_item(
    uuid, uuid, uuid, uuid, bigint, integer, uuid, uuid, numeric, text, text, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assessment.add_exam_item(
    uuid, uuid, uuid, uuid, bigint, integer, uuid, uuid, numeric, text, text, text, text
) TO aether_assessment_app;

RESET ROLE;
