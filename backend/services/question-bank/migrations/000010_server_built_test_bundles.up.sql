-- Test bundles are built, encrypted and stored by Question Bank itself from
-- plaintext tests, so clients no longer supply object references. A draft
-- version therefore has no evaluation bundle until its tests are uploaded;
-- publication still requires one. Draft test manifests (hidden included) may be
-- replaced; published and retired versions stay fully immutable.
SET ROLE aether_question_bank_owner;

ALTER TABLE qbank.question_versions
    ALTER COLUMN evaluation_bundle_object_key DROP NOT NULL,
    ALTER COLUMN evaluation_bundle_checksum DROP NOT NULL,
    ALTER COLUMN encryption_key_reference DROP NOT NULL,
    ADD CONSTRAINT question_versions_published_has_bundle CHECK (
        status = 'draft'
        OR (evaluation_bundle_object_key IS NOT NULL
            AND evaluation_bundle_checksum IS NOT NULL
            AND encryption_key_reference IS NOT NULL)
    );

CREATE OR REPLACE FUNCTION qbank.reject_hidden_manifest_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, qbank
AS $$
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') AND EXISTS (
        SELECT 1
        FROM qbank.question_versions question_version
        WHERE question_version.id = OLD.question_version_id
          AND question_version.published_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'test manifest for published question version % is immutable', OLD.question_version_id
            USING ERRCODE = '55000';
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE') AND EXISTS (
        SELECT 1
        FROM qbank.question_versions question_version
        WHERE question_version.id = NEW.question_version_id
          AND question_version.published_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'test manifest cannot be attached to published question version %', NEW.question_version_id
            USING ERRCODE = '55000';
    END IF;

    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

-- The caller-supplied manifest function is replaced by the server-built one.
REVOKE EXECUTE ON FUNCTION
    qbank.upsert_test_case_manifest(uuid, uuid, text, text, text, text, integer, bigint)
FROM aether_question_bank_app;
DROP FUNCTION qbank.upsert_test_case_manifest(uuid, uuid, text, text, text, text, integer, bigint);

-- Records the evaluation, sample and hidden bundles for a draft version in one
-- step. out_replaced_object_keys lists the objects the new bundles superseded;
-- the caller deletes them from storage once this transaction has committed.
CREATE FUNCTION qbank.set_question_version_tests(
    p_question_version_id uuid,
    p_expected_question_version bigint,
    p_evaluation_object_key text,
    p_evaluation_checksum text,
    p_evaluation_key_reference text,
    p_sample_object_key text,
    p_sample_checksum text,
    p_sample_key_reference text,
    p_sample_count integer,
    p_hidden_object_key text,
    p_hidden_checksum text,
    p_hidden_key_reference text,
    p_hidden_count integer
)
RETURNS TABLE (out_summary jsonb, out_replaced_object_keys text[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qbank, authz, app
AS $function$
DECLARE
    actor_id uuid;
    version_row qbank.question_versions%ROWTYPE;
    replaced text[];
BEGIN
    actor_id := qbank.require_write_context('qbank.test_case_manifests');
    IF p_question_version_id IS NULL
       OR p_expected_question_version IS NULL
       OR p_expected_question_version <= 0
       OR p_evaluation_object_key IS NULL OR p_evaluation_checksum IS NULL OR p_evaluation_key_reference IS NULL
       OR p_sample_object_key IS NULL OR p_sample_checksum IS NULL OR p_sample_key_reference IS NULL
       OR p_hidden_object_key IS NULL OR p_hidden_checksum IS NULL OR p_hidden_key_reference IS NULL
       OR p_sample_count IS NULL OR p_sample_count <= 0
       OR p_hidden_count IS NULL OR p_hidden_count <= 0 THEN
        RAISE EXCEPTION 'test bundle inputs are invalid' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO version_row
    FROM qbank.question_versions
    WHERE id = p_question_version_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'question version was not found' USING ERRCODE = 'P0002';
    END IF;
    IF version_row.status <> 'draft' THEN
        RAISE EXCEPTION 'published question versions cannot change tests' USING ERRCODE = '55000';
    END IF;
    IF version_row.version <> p_expected_question_version THEN
        RAISE EXCEPTION 'question version revision is stale' USING ERRCODE = '40001';
    END IF;

    SELECT COALESCE(array_agg(old_key), ARRAY[]::text[]) INTO replaced
    FROM (
        SELECT version_row.evaluation_bundle_object_key AS old_key
        UNION ALL
        SELECT manifest.object_key
        FROM qbank.test_case_manifests AS manifest
        WHERE manifest.question_version_id = p_question_version_id
    ) AS previous
    WHERE old_key IS NOT NULL;

    INSERT INTO qbank.test_case_manifests (
        id, question_version_id, manifest_kind, object_key, checksum,
        encryption_key_reference, test_case_count, created_by
    ) VALUES
        (gen_random_uuid(), p_question_version_id, 'sample', p_sample_object_key, p_sample_checksum,
         p_sample_key_reference, p_sample_count, actor_id),
        (gen_random_uuid(), p_question_version_id, 'hidden', p_hidden_object_key, p_hidden_checksum,
         p_hidden_key_reference, p_hidden_count, actor_id)
    ON CONFLICT (question_version_id, manifest_kind) DO UPDATE
    SET object_key = EXCLUDED.object_key,
        checksum = EXCLUDED.checksum,
        encryption_key_reference = EXCLUDED.encryption_key_reference,
        test_case_count = EXCLUDED.test_case_count;

    UPDATE qbank.question_versions
    SET evaluation_bundle_object_key = p_evaluation_object_key,
        evaluation_bundle_checksum = p_evaluation_checksum,
        encryption_key_reference = p_evaluation_key_reference,
        version = version + 1
    WHERE id = p_question_version_id;

    RETURN QUERY SELECT qbank.question_version_summary(p_question_version_id), replaced;
END
$function$;

REVOKE ALL ON FUNCTION
    qbank.set_question_version_tests(uuid, bigint, text, text, text, text, text, text, integer, text, text, text, integer)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
    qbank.set_question_version_tests(uuid, bigint, text, text, text, text, text, text, integer, text, text, text, integer)
TO aether_question_bank_app;

RESET ROLE;
