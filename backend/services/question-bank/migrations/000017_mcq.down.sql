SET ROLE aether_question_bank_owner;

DO $block$
BEGIN
    IF EXISTS (SELECT 1 FROM qbank.question_versions WHERE kind = 'mcq' OR jsonb_array_length(supported_languages) = 0) THEN
        RAISE EXCEPTION 'multiple-choice questions exist; remove them before reverting 000017';
    END IF;
END
$block$;

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
    out_prompt_markdown text
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
           sample.test_case_count, hidden.test_case_count, version.prompt_markdown
    FROM qbank.question_versions AS version
    JOIN qbank.questions AS question ON question.id = version.question_id
    JOIN qbank.test_case_manifests AS sample
      ON sample.question_version_id = version.id AND sample.manifest_kind = 'sample'
    JOIN qbank.test_case_manifests AS hidden
      ON hidden.question_version_id = version.id AND hidden.manifest_kind = 'hidden'
    WHERE version.id = p_question_version_id
      AND version.status = 'published'
      AND version.deleted_at IS NULL
      AND question.lifecycle_state <> 'archived'
      AND question.deleted_at IS NULL
$function$;
REVOKE ALL ON FUNCTION qbank.resolve_published_question_version(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION qbank.resolve_published_question_version(uuid) TO aether_question_bank_app;

CREATE OR REPLACE FUNCTION qbank.require_publish_ready()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, qbank
AS $function$
BEGIN
    IF NEW.status = 'published'
       AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'published') THEN
        IF NEW.published_at IS NULL
           OR jsonb_array_length(NEW.supported_languages) < 1
           OR NOT EXISTS (
               SELECT 1 FROM qbank.test_case_manifests AS manifest
               WHERE manifest.question_version_id = NEW.id
                 AND manifest.manifest_kind = 'sample'
           )
           OR NOT EXISTS (
               SELECT 1 FROM qbank.test_case_manifests AS manifest
               WHERE manifest.question_version_id = NEW.id
                 AND manifest.manifest_kind = 'hidden'
           )
           OR EXISTS (
               SELECT 1 FROM qbank.questions AS question
               WHERE question.id = NEW.question_id
                 AND question.lifecycle_state = 'archived'
           ) THEN
            RAISE EXCEPTION 'published question versions require sample and hidden manifests, languages, and an active question'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END
$function$;

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
        'asset_count', COALESCE(assets.asset_count, 0)
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

DROP FUNCTION qbank.set_question_version_choices(uuid, bigint, jsonb, integer[], boolean);
ALTER TABLE qbank.question_versions
    DROP CONSTRAINT question_versions_published_has_bundle,
    ADD CONSTRAINT question_versions_published_has_bundle CHECK (
        status = 'draft'
        OR (evaluation_bundle_object_key IS NOT NULL
            AND evaluation_bundle_checksum IS NOT NULL
            AND encryption_key_reference IS NOT NULL)
    ),
    ADD CONSTRAINT question_versions_supported_languages_nonempty CHECK (jsonb_array_length(supported_languages) > 0),
    DROP COLUMN multiple_choice,
    DROP COLUMN correct_choices,
    DROP COLUMN choices,
    DROP COLUMN kind;

RESET ROLE;
