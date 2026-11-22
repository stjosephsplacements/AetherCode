-- Restore question_version_summary without created_by (body from 000026).
SET ROLE aether_question_bank_owner;

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
        'choice_explanations', question_version.choice_explanations,
        'multiple_choice', question_version.multiple_choice,
        'review_requested_at', question_version.review_requested_at,
        'review_requested_by', question_version.review_requested_by,
        'assigned_reviewer_id', question_version.assigned_reviewer_id,
        'audience', (SELECT question.audience FROM qbank.questions AS question WHERE question.id = question_version.question_id),
        'category_id', (SELECT question.category_id FROM qbank.questions AS question WHERE question.id = question_version.question_id),
        'category', (
            SELECT jsonb_build_object('id', category.id, 'name', category.name)
            FROM qbank.questions AS question JOIN qbank.categories AS category ON category.id = question.category_id
            WHERE question.id = question_version.question_id
        )
    )
    FROM qbank.question_versions AS question_version
    LEFT JOIN LATERAL (
        SELECT jsonb_agg(
            jsonb_build_object('id', tag.id, 'name', tag.name)
            ORDER BY tag.normalized_name
        ) AS items
        FROM qbank.question_tags AS question_tag
        JOIN qbank.tags AS tag ON tag.id = question_tag.tag_id
        WHERE question_tag.question_id = question_version.question_id
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

RESET ROLE;
