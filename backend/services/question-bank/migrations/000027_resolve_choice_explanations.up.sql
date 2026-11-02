-- Assessment pins a multiple-choice version's explanations beside its options (ADR-0058).
-- They are shown to a candidate only after results are released; the exam paper never carries them.
SET ROLE aether_question_bank_owner;

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
    out_multiple_choice boolean,
    out_choice_explanations jsonb
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
           version.kind, version.choices, version.correct_choices, version.multiple_choice,
           version.choice_explanations
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
