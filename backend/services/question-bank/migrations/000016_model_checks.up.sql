-- Model-solution checks (ADR-0033). An author runs a reference solution on all
-- of a version's tests, hidden ones included, before publishing it. Question
-- Bank submits the job to Judge as its own client; the completion worker
-- (projection worker role) records the per-test verdicts.
SET ROLE aether_question_bank_owner;

CREATE TABLE qbank.model_checks (
    id uuid PRIMARY KEY,
    question_version_id uuid NOT NULL REFERENCES qbank.question_versions (id) ON DELETE RESTRICT,
    language_key text NOT NULL CHECK (length(language_key) BETWEEN 1 AND 50),
    source_object_key text NOT NULL CHECK (length(source_object_key) > 0),
    source_checksum char(64) NOT NULL CHECK (source_checksum ~ '^[0-9a-f]{64}$'),
    source_key_reference text NOT NULL CHECK (length(source_key_reference) > 0),
    requested_by uuid NOT NULL,
    requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    lifecycle_state text NOT NULL DEFAULT 'queued' CHECK (lifecycle_state IN ('queued', 'completed', 'failed')),
    verdict text,
    units jsonb CHECK (units IS NULL OR jsonb_typeof(units) = 'array'),
    completed_at timestamptz,
    CHECK ((lifecycle_state = 'queued') = (completed_at IS NULL))
);
CREATE INDEX model_checks_version_idx ON qbank.model_checks (question_version_id, requested_at DESC);
ALTER TABLE qbank.model_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE qbank.model_checks FORCE ROW LEVEL SECURITY;
CREATE POLICY qbank_model_checks_owner_maintenance ON qbank.model_checks
    FOR ALL TO aether_question_bank_owner USING (true) WITH CHECK (true);

-- Records a check for an author and returns what Judge needs: the version's
-- evaluation bundle and limits. The language must be one the version allows.
CREATE FUNCTION qbank.start_model_check(
    p_id uuid,
    p_question_version_id uuid,
    p_language_key text,
    p_source_object_key text,
    p_source_checksum text,
    p_source_key_reference text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qbank, authz, app
AS $function$
DECLARE
    actor_id uuid;
    version_row qbank.question_versions%ROWTYPE;
BEGIN
    actor_id := qbank.require_write_context('qbank.question_versions');
    SELECT * INTO version_row FROM qbank.question_versions
    WHERE id = p_question_version_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'question version was not found' USING ERRCODE = 'P0002';
    END IF;
    IF version_row.evaluation_bundle_object_key IS NULL THEN
        RAISE EXCEPTION 'save the tests before checking a solution' USING ERRCODE = '55000';
    END IF;
    IF NOT version_row.supported_languages ? p_language_key THEN
        RAISE EXCEPTION 'the question does not allow this language' USING ERRCODE = '22023';
    END IF;
    IF (SELECT count(*) FROM qbank.model_checks
        WHERE question_version_id = p_question_version_id AND lifecycle_state = 'queued') >= 3 THEN
        RAISE EXCEPTION 'wait for the running checks to finish' USING ERRCODE = '55000';
    END IF;
    INSERT INTO qbank.model_checks (id, question_version_id, language_key, source_object_key, source_checksum,
                                    source_key_reference, requested_by)
    VALUES (p_id, p_question_version_id, p_language_key, p_source_object_key, lower(p_source_checksum),
            p_source_key_reference, actor_id);
    RETURN jsonb_build_object(
        'evaluation_bundle_object_key', version_row.evaluation_bundle_object_key,
        'evaluation_bundle_checksum', lower(version_row.evaluation_bundle_checksum::text),
        'encryption_key_reference', version_row.encryption_key_reference,
        'time_limit_ms', version_row.time_limit_ms,
        'memory_limit_kib', version_row.memory_limit_kib
    );
END
$function$;

CREATE FUNCTION qbank.list_model_checks(p_question_version_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, qbank, authz, app
AS $function$
BEGIN
    PERFORM qbank.require_read_context('qbank.question_versions');
    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                   'id', recent.id, 'language', recent.language_key, 'lifecycle_state', recent.lifecycle_state,
                   'verdict', recent.verdict, 'units', COALESCE(recent.units, '[]'::jsonb),
                   'requested_at', recent.requested_at, 'completed_at', recent.completed_at
               ) ORDER BY recent.requested_at DESC)
        FROM (SELECT * FROM qbank.model_checks WHERE question_version_id = p_question_version_id
              ORDER BY requested_at DESC LIMIT 10) AS recent
    ), '[]'::jsonb);
END
$function$;

-- The completion worker records Judge's verdicts. It returns false for an
-- unknown check, which the worker still acknowledges.
CREATE FUNCTION qbank.finish_model_check(p_id uuid, p_lifecycle_state text, p_verdict text, p_units jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qbank
AS $function$
BEGIN
    IF p_lifecycle_state NOT IN ('completed', 'failed') THEN
        RAISE EXCEPTION 'invalid model check state' USING ERRCODE = '22023';
    END IF;
    UPDATE qbank.model_checks
    SET lifecycle_state = p_lifecycle_state, verdict = p_verdict,
        units = COALESCE(p_units, '[]'::jsonb), completed_at = clock_timestamp()
    WHERE id = p_id AND lifecycle_state = 'queued';
    RETURN EXISTS (SELECT 1 FROM qbank.model_checks WHERE id = p_id);
END
$function$;

REVOKE ALL ON FUNCTION qbank.start_model_check(uuid, uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION qbank.list_model_checks(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION qbank.finish_model_check(uuid, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION qbank.start_model_check(uuid, uuid, text, text, text, text) TO aether_question_bank_app;
GRANT EXECUTE ON FUNCTION qbank.list_model_checks(uuid) TO aether_question_bank_app;
-- The worker reaches only this function in the qbank schema.
GRANT USAGE ON SCHEMA qbank TO aether_question_bank_projection_worker;
GRANT EXECUTE ON FUNCTION qbank.finish_model_check(uuid, text, text, jsonb) TO aether_question_bank_projection_worker;

RESET ROLE;
