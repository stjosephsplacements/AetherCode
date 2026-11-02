-- Why each multiple-choice option is right or wrong (ADR-0058).
--
-- choice_explanations is null, or an array as long as choices whose entries are
-- text (up to 1,000 characters) or null. It is part of the version like the
-- choices, so a published version refuses edits. It is not in the resolve
-- function, so the exam runner's snapshot never carries it.
SET ROLE aether_question_bank_owner;

CREATE FUNCTION qbank.valid_choice_explanations(p_choices jsonb, p_explanations jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
    SELECT p_explanations IS NULL OR (
        jsonb_typeof(p_explanations) = 'array'
        AND p_choices IS NOT NULL
        AND jsonb_array_length(p_explanations) = jsonb_array_length(p_choices)
        AND NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(p_explanations) AS explanation
            WHERE jsonb_typeof(explanation) NOT IN ('string', 'null')
               OR (jsonb_typeof(explanation) = 'string' AND char_length(explanation #>> '{}') NOT BETWEEN 1 AND 1000)
        )
    )
$function$;

ALTER TABLE qbank.question_versions
    ADD COLUMN choice_explanations jsonb,
    ADD CONSTRAINT question_versions_choice_explanations_check
        CHECK (qbank.valid_choice_explanations(choices, choice_explanations));

-- Gains p_explanations, null when omitted: a pod on the previous release that
-- calls with five arguments still works, and replacing the options clears the explanations.
DROP FUNCTION qbank.set_question_version_choices(uuid, bigint, jsonb, integer[], boolean);
CREATE FUNCTION qbank.set_question_version_choices(
    p_question_version_id uuid,
    p_expected_question_version bigint,
    p_choices jsonb,
    p_correct_choices integer[],
    p_multiple_choice boolean,
    p_explanations jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qbank, authz, app
AS $function$
DECLARE
    version_row qbank.question_versions%ROWTYPE;
    choice_count integer;
BEGIN
    PERFORM qbank.require_write_context('qbank.question_versions');
    choice_count := CASE WHEN jsonb_typeof(p_choices) = 'array' THEN jsonb_array_length(p_choices) ELSE 0 END;
    IF choice_count NOT BETWEEN 2 AND 10
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_choices) AS choice
                  WHERE jsonb_typeof(choice) <> 'string' OR length(btrim(choice #>> '{}')) NOT BETWEEN 1 AND 2000)
       OR p_correct_choices IS NULL OR cardinality(p_correct_choices) < 1
       OR EXISTS (SELECT 1 FROM unnest(p_correct_choices) AS correct WHERE correct IS NULL OR correct < 0 OR correct >= choice_count)
       OR (SELECT count(DISTINCT correct) FROM unnest(p_correct_choices) AS correct) <> cardinality(p_correct_choices)
       OR p_multiple_choice IS NULL
       OR (NOT p_multiple_choice AND cardinality(p_correct_choices) <> 1) THEN
        RAISE EXCEPTION 'a multiple-choice question needs 2 to 10 options and its correct answer' USING ERRCODE = '22023';
    END IF;
    IF NOT qbank.valid_choice_explanations(p_choices, p_explanations) THEN
        RAISE EXCEPTION 'give one explanation or none for each option, up to 1000 characters each' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO version_row FROM qbank.question_versions
    WHERE id = p_question_version_id AND deleted_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'question version was not found' USING ERRCODE = 'P0002';
    END IF;
    IF version_row.status <> 'draft' THEN
        RAISE EXCEPTION 'only draft question versions may change' USING ERRCODE = '55000';
    END IF;
    IF version_row.version <> p_expected_question_version THEN
        RAISE EXCEPTION 'question version revision is stale' USING ERRCODE = '40001';
    END IF;
    UPDATE qbank.question_versions
    SET kind = 'mcq', choices = p_choices, choice_explanations = p_explanations,
        correct_choices = (SELECT array_agg(correct ORDER BY correct) FROM unnest(p_correct_choices) AS correct),
        multiple_choice = p_multiple_choice, version = version + 1
    WHERE id = p_question_version_id;
    RETURN qbank.question_version_summary(p_question_version_id);
END
$function$;
REVOKE ALL ON FUNCTION qbank.set_question_version_choices(uuid, bigint, jsonb, integer[], boolean, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION qbank.set_question_version_choices(uuid, bigint, jsonb, integer[], boolean, jsonb) TO aether_question_bank_app;

-- The staff view of a version carries the explanations beside the choices.
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
