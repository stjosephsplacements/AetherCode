SET ROLE aether_question_bank_owner;

-- Draft versions may now lack a bundle; restoring NOT NULL is only possible
-- once every version has one.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM qbank.question_versions
        WHERE evaluation_bundle_object_key IS NULL
           OR evaluation_bundle_checksum IS NULL
           OR encryption_key_reference IS NULL
    ) THEN
        RAISE EXCEPTION 'cannot restore NOT NULL bundle columns: draft question versions without uploaded tests exist; upload their tests or delete them first';
    END IF;
END
$$;

REVOKE EXECUTE ON FUNCTION
    qbank.set_question_version_tests(uuid, bigint, text, text, text, text, text, text, integer, text, text, text, integer)
FROM aether_question_bank_app;
DROP FUNCTION qbank.set_question_version_tests(uuid, bigint, text, text, text, text, text, text, integer, text, text, text, integer);

CREATE OR REPLACE FUNCTION qbank.reject_hidden_manifest_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, qbank
AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND (OLD.manifest_kind = 'hidden' OR NEW.manifest_kind = 'hidden') THEN
        RAISE EXCEPTION 'hidden test manifest % is immutable', OLD.id
            USING ERRCODE = '55000';
    END IF;

    IF TG_OP = 'DELETE' AND OLD.manifest_kind = 'hidden' THEN
        RAISE EXCEPTION 'hidden test manifest % is immutable', OLD.id
            USING ERRCODE = '55000';
    END IF;

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

CREATE FUNCTION qbank.upsert_test_case_manifest(
    p_manifest_id uuid,
    p_question_version_id uuid,
    p_manifest_kind text,
    p_object_key text,
    p_checksum text,
    p_encryption_key_reference text,
    p_test_case_count integer,
    p_expected_question_version bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qbank, authz, app
AS $function$
DECLARE
    actor_id uuid;
    version_row qbank.question_versions%ROWTYPE;
    response jsonb;
BEGIN
    actor_id := qbank.require_write_context('qbank.test_case_manifests');
    IF p_manifest_id IS NULL
       OR p_question_version_id IS NULL
       OR p_manifest_kind NOT IN ('sample', 'hidden')
       OR p_test_case_count IS NULL
       OR p_expected_question_version <= 0 THEN
        RAISE EXCEPTION 'test manifest inputs are invalid' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO version_row
    FROM qbank.question_versions
    WHERE id = p_question_version_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'question version was not found' USING ERRCODE = 'P0002';
    END IF;
    IF version_row.status <> 'draft' THEN
        RAISE EXCEPTION 'published question versions cannot change manifests' USING ERRCODE = '55000';
    END IF;
    IF version_row.version <> p_expected_question_version THEN
        RAISE EXCEPTION 'question version revision is stale' USING ERRCODE = '40001';
    END IF;

    IF p_manifest_kind = 'hidden' THEN
        INSERT INTO qbank.test_case_manifests (
            id, question_version_id, manifest_kind, object_key, checksum,
            encryption_key_reference, test_case_count, created_by
        ) VALUES (
            p_manifest_id, p_question_version_id, p_manifest_kind, p_object_key, p_checksum,
            p_encryption_key_reference, p_test_case_count, actor_id
        );
    ELSE
        INSERT INTO qbank.test_case_manifests (
            id, question_version_id, manifest_kind, object_key, checksum,
            encryption_key_reference, test_case_count, created_by
        ) VALUES (
            p_manifest_id, p_question_version_id, p_manifest_kind, p_object_key, p_checksum,
            p_encryption_key_reference, p_test_case_count, actor_id
        ) ON CONFLICT (question_version_id, manifest_kind) DO UPDATE
        SET object_key = EXCLUDED.object_key,
            checksum = EXCLUDED.checksum,
            encryption_key_reference = EXCLUDED.encryption_key_reference,
            test_case_count = EXCLUDED.test_case_count;
    END IF;
    UPDATE qbank.question_versions
    SET version = version + 1
    WHERE id = p_question_version_id;
    SELECT qbank.question_version_summary(p_question_version_id) INTO response;
    RETURN response;
END
$function$;


REVOKE ALL ON FUNCTION
    qbank.upsert_test_case_manifest(uuid, uuid, text, text, text, text, integer, bigint)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
    qbank.upsert_test_case_manifest(uuid, uuid, text, text, text, text, integer, bigint)
TO aether_question_bank_app;

ALTER TABLE qbank.question_versions
    DROP CONSTRAINT question_versions_published_has_bundle,
    ALTER COLUMN evaluation_bundle_object_key SET NOT NULL,
    ALTER COLUMN evaluation_bundle_checksum SET NOT NULL,
    ALTER COLUMN encryption_key_reference SET NOT NULL;

RESET ROLE;
