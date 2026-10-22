SET ROLE aether_question_bank_owner;

DROP FUNCTION qbank.publish_question_version(uuid, uuid, bigint, boolean);
CREATE FUNCTION qbank.publish_question_version(
    p_question_version_id uuid,
    p_event_id uuid,
    p_expected_question_version bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qbank, authz, app
AS $function$
DECLARE
    version_row qbank.question_versions%ROWTYPE;
    question_row qbank.questions%ROWTYPE;
    published_at_value timestamptz;
    response jsonb;
BEGIN
    PERFORM qbank.require_write_context('qbank.question_versions');
    IF p_question_version_id IS NULL OR p_event_id IS NULL OR p_expected_question_version <= 0 THEN
        RAISE EXCEPTION 'question version publication inputs are invalid' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO version_row
    FROM qbank.question_versions
    WHERE id = p_question_version_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'question version was not found' USING ERRCODE = 'P0002';
    END IF;
    IF version_row.status <> 'draft' THEN
        RAISE EXCEPTION 'only draft question versions may be published' USING ERRCODE = '55000';
    END IF;
    IF version_row.version <> p_expected_question_version THEN
        RAISE EXCEPTION 'question version revision is stale' USING ERRCODE = '40001';
    END IF;
    SELECT * INTO question_row
    FROM qbank.questions
    WHERE id = version_row.question_id
    FOR UPDATE;
    IF question_row.lifecycle_state = 'archived' THEN
        RAISE EXCEPTION 'archived questions cannot be published' USING ERRCODE = '55000';
    END IF;

    UPDATE qbank.question_versions
    SET status = 'published', published_at = clock_timestamp(), version = version + 1
    WHERE id = p_question_version_id
    RETURNING published_at INTO published_at_value;
    UPDATE qbank.questions
    SET lifecycle_state = 'published', version = version + 1
    WHERE id = question_row.id;
    PERFORM qbank.enqueue_question_event(
        p_event_id, 'question_version', p_question_version_id, 'qbank.question.version_published.v1',
        jsonb_build_object(
            'question_id', question_row.id,
            'question_version_id', p_question_version_id,
            'version_number', version_row.version_number,
            'published_at', published_at_value
        )
    );
    SELECT qbank.question_response(question_row.id, p_question_version_id) INTO response;
    RETURN response;
END
$function$;

DROP FUNCTION qbank.list_review_queue(integer);
DROP FUNCTION qbank.request_question_review(uuid, bigint);

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

ALTER TABLE qbank.question_versions
    DROP CONSTRAINT question_versions_review_pair,
    DROP COLUMN review_requested_by,
    DROP COLUMN review_requested_at;

REVOKE ALL ON FUNCTION qbank.publish_question_version(uuid, uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION qbank.publish_question_version(uuid, uuid, bigint) TO aether_question_bank_app;

RESET ROLE;
