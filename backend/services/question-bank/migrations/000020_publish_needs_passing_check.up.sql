-- A coding question is published only after a model solution has passed every
-- test, hidden ones included, in at least one language, on the tests as they
-- are now (ADR-0047). Checks record the bundle they ran on.
SET ROLE aether_question_bank_owner;

ALTER TABLE qbank.model_checks ADD COLUMN bundle_checksum char(64);

CREATE OR REPLACE FUNCTION qbank.start_model_check(
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
                                    source_key_reference, requested_by, bundle_checksum)
    VALUES (p_id, p_question_version_id, p_language_key, p_source_object_key, lower(p_source_checksum),
            p_source_key_reference, actor_id, lower(version_row.evaluation_bundle_checksum::text));
    RETURN jsonb_build_object(
        'evaluation_bundle_object_key', version_row.evaluation_bundle_object_key,
        'evaluation_bundle_checksum', lower(version_row.evaluation_bundle_checksum::text),
        'encryption_key_reference', version_row.encryption_key_reference,
        'time_limit_ms', version_row.time_limit_ms,
        'memory_limit_kib', version_row.memory_limit_kib
    );
END
$function$;

CREATE OR REPLACE FUNCTION qbank.list_model_checks(p_question_version_id uuid)
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
                   'requested_at', recent.requested_at, 'completed_at', recent.completed_at,
                   'current', recent.bundle_checksum IS NOT DISTINCT FROM lower(recent.current_checksum::text)
               ) ORDER BY recent.requested_at DESC)
        FROM (SELECT check_row.*, version_row.evaluation_bundle_checksum AS current_checksum
              FROM qbank.model_checks AS check_row
              JOIN qbank.question_versions AS version_row ON version_row.id = check_row.question_version_id
              WHERE check_row.question_version_id = p_question_version_id
              ORDER BY check_row.requested_at DESC LIMIT 10) AS recent
    ), '[]'::jsonb);
END
$function$;

CREATE OR REPLACE FUNCTION qbank.publish_question_version(
    p_question_version_id uuid,
    p_event_id uuid,
    p_expected_question_version bigint,
    p_require_review boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qbank, authz, app
AS $function$
DECLARE
    version_row qbank.question_versions%ROWTYPE;
    question_row qbank.questions%ROWTYPE;
    published_at_value timestamptz;
    actor_id uuid;
    response jsonb;
BEGIN
    actor_id := qbank.require_write_context('qbank.question_versions');
    IF p_question_version_id IS NULL OR p_event_id IS NULL OR p_expected_question_version <= 0 THEN
        RAISE EXCEPTION 'question version publication inputs are invalid' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO version_row
    FROM qbank.question_versions
    WHERE id = p_question_version_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'question version was not found' USING ERRCODE = 'P0002';
    END IF;
    IF version_row.status <> 'draft' THEN
        RAISE EXCEPTION 'only draft question versions may be published' USING ERRCODE = '55000';
    END IF;
    IF version_row.version <> p_expected_question_version THEN
        RAISE EXCEPTION 'question version revision is stale' USING ERRCODE = '40001';
    END IF;
    IF version_row.kind <> 'mcq' AND NOT EXISTS (
        SELECT 1 FROM qbank.model_checks AS passed
        WHERE passed.question_version_id = p_question_version_id
          AND passed.lifecycle_state = 'completed' AND passed.verdict = 'accepted'
          AND passed.bundle_checksum = lower(version_row.evaluation_bundle_checksum::text)
    ) THEN
        RAISE EXCEPTION 'run a model solution that passes every test before publishing' USING ERRCODE = '55000';
    END IF;
    IF p_require_review THEN
        IF version_row.review_requested_at IS NULL THEN
            RAISE EXCEPTION 'ask for a review before publishing' USING ERRCODE = '55000';
        END IF;
        IF version_row.review_requested_by = actor_id THEN
            RAISE EXCEPTION 'a different member of staff must approve this version' USING ERRCODE = '42501';
        END IF;
    END IF;
    SELECT * INTO question_row
    FROM qbank.questions
    WHERE id = version_row.question_id
    FOR UPDATE;
    IF question_row.lifecycle_state = 'archived' THEN
        RAISE EXCEPTION 'archived questions cannot be published' USING ERRCODE = '55000';
    END IF;

    UPDATE qbank.question_versions
    SET status = 'published', published_at = clock_timestamp(), version = version + 1
    WHERE id = p_question_version_id
    RETURNING published_at INTO published_at_value;
    UPDATE qbank.questions
    SET lifecycle_state = 'published', version = version + 1
    WHERE id = question_row.id;
    PERFORM qbank.enqueue_question_event(
        p_event_id, 'question_version', p_question_version_id, 'qbank.question.version_published.v1',
        jsonb_build_object(
            'question_id', question_row.id,
            'question_version_id', p_question_version_id,
            'version_number', version_row.version_number,
            'published_at', published_at_value
        )
    );
    SELECT qbank.question_response(question_row.id, p_question_version_id) INTO response;
    RETURN response;
END
$function$;

RESET ROLE;
