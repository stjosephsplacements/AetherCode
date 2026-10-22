-- Question export (ADR-0032). Exporting reveals a question's hidden tests, so
-- it needs a write context on question_exports, which only college and
-- platform administrators can obtain, and every export is recorded.
SET ROLE aether_question_bank_owner;

CREATE TABLE qbank.question_export_events (
    id uuid PRIMARY KEY,
    question_version_id uuid NOT NULL REFERENCES qbank.question_versions (id) ON DELETE RESTRICT,
    actor_id uuid NOT NULL,
    exported_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX question_export_events_version_idx ON qbank.question_export_events (question_version_id, exported_at DESC);
ALTER TABLE qbank.question_export_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE qbank.question_export_events FORCE ROW LEVEL SECURITY;
CREATE POLICY qbank_question_export_events_owner_maintenance ON qbank.question_export_events
    FOR ALL TO aether_question_bank_owner USING (true) WITH CHECK (true);

-- Records the export and returns the version's content and the storage
-- references of its evaluation bundle (every test, in order) and sample
-- bundle, which the service decrypts.
CREATE FUNCTION qbank.export_question_version(p_event_id uuid, p_question_version_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qbank, authz, app
AS $function$
DECLARE
    actor_id uuid;
    response jsonb;
BEGIN
    actor_id := qbank.require_write_context('qbank.question_exports');
    IF p_event_id IS NULL OR p_question_version_id IS NULL THEN
        RAISE EXCEPTION 'question export command is invalid' USING ERRCODE = '22023';
    END IF;
    SELECT jsonb_build_object(
               'title', version.title,
               'prompt_markdown', version.prompt_markdown,
               'difficulty', version.difficulty,
               'supported_languages', version.supported_languages,
               'time_limit_ms', version.time_limit_ms,
               'memory_limit_kib', version.memory_limit_kib,
               'evaluation', CASE WHEN version.evaluation_bundle_object_key IS NULL THEN NULL ELSE jsonb_build_object(
                   'object_key', version.evaluation_bundle_object_key,
                   'checksum', lower(version.evaluation_bundle_checksum::text),
                   'encryption_key_reference', version.encryption_key_reference
               ) END,
               'sample', (
                   SELECT jsonb_build_object('object_key', manifest.object_key, 'checksum', lower(manifest.checksum::text),
                                             'encryption_key_reference', manifest.encryption_key_reference)
                   FROM qbank.test_case_manifests AS manifest
                   WHERE manifest.question_version_id = version.id AND manifest.manifest_kind = 'sample'
               )
           )
    INTO response
    FROM qbank.question_versions AS version
    WHERE version.id = p_question_version_id AND version.deleted_at IS NULL;
    IF response IS NULL THEN
        RAISE EXCEPTION 'question version was not found' USING ERRCODE = 'P0002';
    END IF;
    INSERT INTO qbank.question_export_events (id, question_version_id, actor_id)
    VALUES (p_event_id, p_question_version_id, actor_id);
    RETURN response;
END
$function$;

REVOKE ALL ON FUNCTION qbank.export_question_version(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION qbank.export_question_version(uuid, uuid) TO aether_question_bank_app;

RESET ROLE;
