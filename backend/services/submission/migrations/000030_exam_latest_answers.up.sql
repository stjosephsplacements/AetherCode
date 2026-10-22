-- Each attempt's latest saved code per question for one exam version, for the
-- staff similarity report (ADR-0031). It authorizes on judge_receipts, the
-- reviewer resource no candidate self scope can obtain, and returns storage
-- references the service decrypts.
SET ROLE aether_submission_owner;

CREATE FUNCTION submission.list_exam_latest_answers(p_tenant_id uuid, p_exam_version_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, authz, submission
AS $function$
DECLARE
    response jsonb;
BEGIN
    IF p_tenant_id IS NULL OR p_exam_version_id IS NULL OR NOT authz.current_context_allows_read(
        p_tenant_id, 'submission.read', 'submission.write', 'submission.judge_receipts'
    ) THEN
        RAISE EXCEPTION 'signed authorization context does not allow this submission operation'
            USING ERRCODE = '42501';
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'attempt_id', attempt.id,
               'candidate_id', attempt.candidate_id,
               'exam_item_id', latest.exam_item_id,
               'position', item.position,
               'title', item.title,
               'language', latest.language_id,
               'source_object_key', latest.source_object_key,
               'source_checksum', lower(latest.source_checksum::text),
               'encryption_key_reference', latest.encryption_key_reference
           ) ORDER BY item.position NULLS LAST, latest.exam_item_id, attempt.id), '[]'::jsonb)
    INTO response
    FROM submission.attempts AS attempt
    CROSS JOIN LATERAL (
        SELECT DISTINCT ON (revision.exam_item_id) revision.*
        FROM submission.answer_revisions AS revision
        WHERE revision.tenant_id = attempt.tenant_id AND revision.attempt_id = attempt.id
        ORDER BY revision.exam_item_id, revision.revision_number DESC
    ) AS latest
    LEFT JOIN submission.assignment_item_projections AS item
      ON item.tenant_id = attempt.tenant_id
     AND item.candidate_assignment_id = attempt.candidate_assignment_id
     AND item.exam_item_id = latest.exam_item_id
    WHERE attempt.tenant_id = p_tenant_id
      AND attempt.exam_version_id = p_exam_version_id
      AND attempt.deleted_at IS NULL;
    RETURN response;
END
$function$;

REVOKE ALL ON FUNCTION submission.list_exam_latest_answers(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submission.list_exam_latest_answers(uuid, uuid) TO aether_submission_app;

RESET ROLE;
