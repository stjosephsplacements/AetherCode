SET ROLE aether_question_bank_owner;

-- The internal gRPC contract (QuestionBankInternalService) lets Assessment pin
-- a published version's encrypted bundles to an exam item. The caller is a
-- service authenticated by mTLS, not a user, so there is no request
-- capability; the function exposes only object references, which are useless
-- without the KMS key, and only for a published version of a live question.
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
    out_hidden_count integer
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
           sample.test_case_count, hidden.test_case_count
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

RESET ROLE;
