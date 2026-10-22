-- A review request can name the reviewer it is waiting for (ADR-0044). It is a
-- hint for the queue, not a restriction: any other member of staff may still
-- approve.
SET ROLE aether_question_bank_owner;

ALTER TABLE qbank.question_versions ADD COLUMN assigned_reviewer_id uuid;

CREATE OR REPLACE FUNCTION qbank.question_version_summary(p_question_version_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, qbank
AS $function$
    SELECT jsonb_build_object(
        'id', question_version.id,
        'question_id', question_version.question_id,
        'version_number', question_version.version_number,
        'title', question_version.title,
        'prompt_markdown', question_version.prompt_markdown,
        'difficulty', question_version.difficulty,
        'supported_languages', question_version.supported_languages,
        'time_limit_ms', question_version.time_limit_ms,
        'memory_limit_kib', question_version.memory_limit_kib,
        'status', question_version.status,
        'published_at', question_version.published_at,
        'created_at', question_version.created_at,
        'version', question_version.version,
        'tags', COALESCE(tags.items, '[]'::jsonb),
        'sample_test_case_count', COALESCE(manifests.sample_test_case_count, 0),
        'hidden_test_case_count', COALESCE(manifests.hidden_test_case_count, 0),
        'asset_count', COALESCE(assets.asset_count, 0),
        'kind', question_version.kind,
        'choices', question_version.choices,
        'correct_choices', to_jsonb(question_version.correct_choices),
        'multiple_choice', question_version.multiple_choice,
        'review_requested_at', question_version.review_requested_at,
        'review_requested_by', question_version.review_requested_by,
        'assigned_reviewer_id', question_version.assigned_reviewer_id,
        'audience', (SELECT question.audience FROM qbank.questions AS question WHERE question.id = question_version.question_id)
    )
    FROM qbank.question_versions AS question_version
    LEFT JOIN LATERAL (
        SELECT jsonb_agg(
            jsonb_build_object('id', tag.id, 'name', tag.name)
            ORDER BY tag.normalized_name
        ) AS items
        FROM qbank.question_version_tags AS question_version_tag
        JOIN qbank.tags AS tag ON tag.id = question_version_tag.tag_id
        WHERE question_version_tag.question_version_id = question_version.id
    ) AS tags ON true
    LEFT JOIN LATERAL (
        SELECT
            COALESCE(sum(test_manifest.test_case_count) FILTER (WHERE test_manifest.manifest_kind = 'sample'), 0)::integer
                AS sample_test_case_count,
            COALESCE(sum(test_manifest.test_case_count) FILTER (WHERE test_manifest.manifest_kind = 'hidden'), 0)::integer
                AS hidden_test_case_count
        FROM qbank.test_case_manifests AS test_manifest
        WHERE test_manifest.question_version_id = question_version.id
    ) AS manifests ON true
    LEFT JOIN LATERAL (
        SELECT count(*)::integer AS asset_count
        FROM qbank.question_assets AS asset
        WHERE asset.question_version_id = question_version.id
    ) AS assets ON true
    WHERE question_version.id = p_question_version_id
$function$;

DROP FUNCTION qbank.request_question_review(uuid, bigint);
CREATE FUNCTION qbank.request_question_review(p_question_version_id uuid, p_expected_question_version bigint, p_reviewer_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qbank, authz, app
AS $function$
DECLARE
    actor_id uuid;
    version_row qbank.question_versions%ROWTYPE;
BEGIN
    actor_id := qbank.require_write_context('qbank.question_versions');
    IF p_question_version_id IS NULL OR p_expected_question_version IS NULL OR p_expected_question_version <= 0 THEN
        RAISE EXCEPTION 'review request inputs are invalid' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO version_row FROM qbank.question_versions
    WHERE id = p_question_version_id AND deleted_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'question version was not found' USING ERRCODE = 'P0002';
    END IF;
    IF version_row.status <> 'draft' THEN
        RAISE EXCEPTION 'only draft question versions may be sent for review' USING ERRCODE = '55000';
    END IF;
    IF version_row.version <> p_expected_question_version THEN
        RAISE EXCEPTION 'question version revision is stale' USING ERRCODE = '40001';
    END IF;
    IF p_reviewer_id = actor_id THEN
        RAISE EXCEPTION 'choose somebody else as the reviewer' USING ERRCODE = '22023';
    END IF;
    UPDATE qbank.question_versions
    SET review_requested_at = clock_timestamp(), review_requested_by = actor_id,
        assigned_reviewer_id = p_reviewer_id, version = version + 1
    WHERE id = p_question_version_id;
    RETURN qbank.question_response(version_row.question_id, p_question_version_id);
END
$function$;

REVOKE ALL ON FUNCTION qbank.request_question_review(uuid, bigint, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION qbank.request_question_review(uuid, bigint, uuid) TO aether_question_bank_app;

RESET ROLE;
