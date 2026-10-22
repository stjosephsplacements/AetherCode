-- Multiple-choice questions (ADR-0035). A version is "coding" (tests) or
-- "mcq": options in authored order, the indexes of the correct ones, and
-- whether more than one may be selected. Grading is all-or-nothing, as in the
-- exam app. An mcq version needs no bundles, tests or languages to publish,
-- and resolves to Assessment with its answer key; students never read the
-- question bank.
SET ROLE aether_question_bank_owner;

ALTER TABLE qbank.question_versions
    ADD COLUMN kind text NOT NULL DEFAULT 'coding' CHECK (kind IN ('coding', 'mcq')),
    ADD COLUMN choices jsonb CHECK (choices IS NULL OR (jsonb_typeof(choices) = 'array'
        AND jsonb_array_length(choices) BETWEEN 2 AND 10)),
    ADD COLUMN correct_choices integer[] CHECK (correct_choices IS NULL OR cardinality(correct_choices) BETWEEN 1 AND 10),
    ADD COLUMN multiple_choice boolean NOT NULL DEFAULT false,
    -- An mcq version has no languages; publishing a coding one still needs
    -- them (require_publish_ready).
    DROP CONSTRAINT question_versions_supported_languages_nonempty,
    DROP CONSTRAINT question_versions_published_has_bundle,
    ADD CONSTRAINT question_versions_published_has_bundle CHECK (
        status = 'draft'
        OR kind = 'mcq'
        OR (evaluation_bundle_object_key IS NOT NULL
            AND evaluation_bundle_checksum IS NOT NULL
            AND encryption_key_reference IS NOT NULL)
    );

-- Makes a draft multiple-choice and sets its options and answer.
CREATE FUNCTION qbank.set_question_version_choices(
    p_question_version_id uuid,
    p_expected_question_version bigint,
    p_choices jsonb,
    p_correct_choices integer[],
    p_multiple_choice boolean
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
    SET kind = 'mcq', choices = p_choices,
        correct_choices = (SELECT array_agg(correct ORDER BY correct) FROM unnest(p_correct_choices) AS correct),
        multiple_choice = p_multiple_choice, version = version + 1
    WHERE id = p_question_version_id;
    RETURN qbank.question_version_summary(p_question_version_id);
END
$function$;
REVOKE ALL ON FUNCTION qbank.set_question_version_choices(uuid, bigint, jsonb, integer[], boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION qbank.set_question_version_choices(uuid, bigint, jsonb, integer[], boolean) TO aether_question_bank_app;

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
        'multiple_choice', question_version.multiple_choice
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

CREATE OR REPLACE FUNCTION qbank.require_publish_ready()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, qbank
AS $function$
BEGIN
    IF NEW.status = 'published'
       AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'published') THEN
        IF NEW.published_at IS NULL OR EXISTS (
               SELECT 1 FROM qbank.questions AS question
               WHERE question.id = NEW.question_id
                 AND question.lifecycle_state = 'archived'
           ) THEN
            RAISE EXCEPTION 'published question versions require an active question'
                USING ERRCODE = '23514';
        END IF;
        IF NEW.kind = 'mcq' THEN
            -- Choices are validated when set; publication only needs them.
            IF NEW.choices IS NULL OR NEW.correct_choices IS NULL THEN
                RAISE EXCEPTION 'a multiple-choice question needs its options and answer before publishing'
                    USING ERRCODE = '23514';
            END IF;
        ELSIF jsonb_array_length(NEW.supported_languages) < 1
           OR NOT EXISTS (
               SELECT 1 FROM qbank.test_case_manifests AS manifest
               WHERE manifest.question_version_id = NEW.id
                 AND manifest.manifest_kind = 'sample'
           )
           OR NOT EXISTS (
               SELECT 1 FROM qbank.test_case_manifests AS manifest
               WHERE manifest.question_version_id = NEW.id
                 AND manifest.manifest_kind = 'hidden'
           ) THEN
            RAISE EXCEPTION 'published question versions require sample and hidden manifests and languages'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END
$function$;

DROP FUNCTION qbank.resolve_published_question_version(uuid);
CREATE FUNCTION qbank.resolve_published_question_version(p_question_version_id uuid)
RETURNS TABLE (
    out_question_id uuid,
    out_version_number integer,
    out_title text,
    out_supported_languages jsonb,
    out_time_limit_ms integer,
    out_memory_limit_kib integer,
    out_evaluation_object_key text,
    out_evaluation_checksum text,
    out_evaluation_key_reference text,
    out_sample_object_key text,
    out_sample_checksum text,
    out_sample_key_reference text,
    out_sample_count integer,
    out_hidden_count integer,
    out_prompt_markdown text,
    out_kind text,
    out_choices jsonb,
    out_correct_choices integer[],
    out_multiple_choice boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, qbank
AS $function$
    SELECT version.question_id, version.version_number, version.title, version.supported_languages,
           version.time_limit_ms, version.memory_limit_kib,
           version.evaluation_bundle_object_key, version.evaluation_bundle_checksum::text,
           version.encryption_key_reference,
           sample.object_key, sample.checksum::text, sample.encryption_key_reference,
           sample.test_case_count, hidden.test_case_count, version.prompt_markdown,
           version.kind, version.choices, version.correct_choices, version.multiple_choice
    FROM qbank.question_versions AS version
    JOIN qbank.questions AS question ON question.id = version.question_id
    LEFT JOIN qbank.test_case_manifests AS sample
      ON sample.question_version_id = version.id AND sample.manifest_kind = 'sample'
    LEFT JOIN qbank.test_case_manifests AS hidden
      ON hidden.question_version_id = version.id AND hidden.manifest_kind = 'hidden'
    WHERE version.id = p_question_version_id
      -- A coding version resolves only with its tests (an mcq one has none).
      AND (version.kind = 'mcq' OR (sample.id IS NOT NULL AND hidden.id IS NOT NULL))
      AND version.status = 'published'
      AND version.deleted_at IS NULL
      AND question.lifecycle_state <> 'archived'
      AND question.deleted_at IS NULL
$function$;
REVOKE ALL ON FUNCTION qbank.resolve_published_question_version(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION qbank.resolve_published_question_version(uuid) TO aether_question_bank_app;

RESET ROLE;
