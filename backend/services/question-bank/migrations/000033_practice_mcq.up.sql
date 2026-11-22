-- Multiple-choice practice (Wave C): practise audience mcq without Judge; show
-- choice explanations after submit (ADR-0058).

ALTER TABLE qbank.practice_submissions
    ALTER COLUMN language_key DROP NOT NULL,
    ALTER COLUMN source_object_key DROP NOT NULL,
    ALTER COLUMN source_checksum DROP NOT NULL,
    ALTER COLUMN source_key_reference DROP NOT NULL,
    ADD COLUMN selected_choices integer[];

ALTER TABLE qbank.practice_submissions
    ADD CONSTRAINT practice_submissions_payload CHECK (
        (selected_choices IS NOT NULL AND language_key IS NULL)
        OR (
            selected_choices IS NULL
            AND language_key IS NOT NULL
            AND source_object_key IS NOT NULL
            AND source_checksum IS NOT NULL
            AND source_key_reference IS NOT NULL
        )
    );

CREATE OR REPLACE FUNCTION qbank.practice_version(p_question_id uuid)
RETURNS qbank.question_versions
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, qbank
AS $function$
    SELECT version.*
    FROM qbank.questions AS question
    JOIN qbank.question_versions AS version ON version.question_id = question.id
    WHERE question.id = p_question_id
      AND question.audience = 'practice'
      AND question.lifecycle_state <> 'archived'
      AND question.deleted_at IS NULL
      AND version.status = 'published'
      AND version.deleted_at IS NULL
      AND version.kind IN ('coding', 'mcq')
    ORDER BY version.version_number DESC
    LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION qbank.list_practice_questions()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, qbank, authz, app
AS $function$
DECLARE
    caller record;
BEGIN
    SELECT * INTO caller FROM qbank.require_practice_context(false);
    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                   'question_id', question.id,
                   'slug', question.slug,
                   'title', version.title,
                   'kind', version.kind,
                   'difficulty', version.difficulty,
                   'tags', qbank.version_tag_names(version.id),
                   'solved', EXISTS (
                       SELECT 1 FROM qbank.practice_submissions AS mine
                       WHERE mine.actor_id = caller.actor_id AND mine.question_id = question.id
                         AND mine.mode = 'submit' AND mine.verdict = 'accepted'),
                   'attempted', EXISTS (
                       SELECT 1 FROM qbank.practice_submissions AS mine
                       WHERE mine.actor_id = caller.actor_id AND mine.question_id = question.id
                         AND mine.mode = 'submit')
               ) ORDER BY CASE version.difficulty WHEN 'easy' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, version.title)
        FROM qbank.questions AS question
        CROSS JOIN LATERAL qbank.practice_version(question.id) AS version
        WHERE question.audience = 'practice' AND version.id IS NOT NULL
    ), '[]'::jsonb);
END
$function$;

CREATE OR REPLACE FUNCTION qbank.get_practice_question(p_question_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, qbank, authz, app
AS $function$
DECLARE
    version qbank.question_versions%ROWTYPE;
    sample qbank.test_case_manifests%ROWTYPE;
BEGIN
    PERFORM qbank.require_practice_context(false);
    version := qbank.practice_version(p_question_id);
    IF version.id IS NULL THEN
        RAISE EXCEPTION 'practice problem was not found' USING ERRCODE = 'P0002';
    END IF;
    SELECT * INTO sample FROM qbank.test_case_manifests
    WHERE question_version_id = version.id AND manifest_kind = 'sample';
    RETURN jsonb_build_object(
        'question_id', p_question_id,
        'question_version_id', version.id,
        'kind', version.kind,
        'title', version.title,
        'prompt_markdown', version.prompt_markdown,
        'difficulty', version.difficulty,
        'languages', version.supported_languages,
        'time_limit_ms', version.time_limit_ms,
        'memory_limit_kib', version.memory_limit_kib,
        'tags', qbank.version_tag_names(version.id),
        'choices', CASE WHEN version.kind = 'mcq' THEN version.choices ELSE NULL END,
        'multiple_choice', CASE WHEN version.kind = 'mcq' THEN version.multiple_choice ELSE NULL END,
        'sample', CASE WHEN sample.id IS NULL THEN NULL ELSE jsonb_build_object(
            'object_key', sample.object_key, 'checksum', lower(sample.checksum::text),
            'encryption_key_reference', sample.encryption_key_reference) END
    );
END
$function$;

CREATE OR REPLACE FUNCTION qbank.start_practice_submission(
    p_id uuid,
    p_question_id uuid,
    p_language_key text,
    p_mode text,
    p_custom_input boolean,
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
    caller record;
    version qbank.question_versions%ROWTYPE;
    sample qbank.test_case_manifests%ROWTYPE;
BEGIN
    SELECT * INTO caller FROM qbank.require_practice_context(true);
    IF p_mode IS NULL OR p_mode NOT IN ('run', 'submit') OR (p_custom_input AND p_mode <> 'run') THEN
        RAISE EXCEPTION 'practice mode must be run or submit' USING ERRCODE = '22023';
    END IF;
    version := qbank.practice_version(p_question_id);
    IF version.id IS NULL THEN
        RAISE EXCEPTION 'practice problem was not found' USING ERRCODE = 'P0002';
    END IF;
    IF version.kind = 'mcq' THEN
        RAISE EXCEPTION 'multiple-choice practice uses selected choices, not code' USING ERRCODE = '22023';
    END IF;
    IF NOT version.supported_languages ? p_language_key THEN
        RAISE EXCEPTION 'the problem does not allow this language' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO sample FROM qbank.test_case_manifests
    WHERE question_version_id = version.id AND manifest_kind = 'sample';
    IF p_mode = 'run' AND NOT p_custom_input AND sample.id IS NULL THEN
        RAISE EXCEPTION 'this problem has no sample tests; run it with your own input' USING ERRCODE = '55000';
    END IF;

    UPDATE qbank.practice_submissions
    SET lifecycle_state = 'failed', verdict = 'internal_error', units = '[]'::jsonb, completed_at = clock_timestamp()
    WHERE lifecycle_state = 'queued' AND requested_at < clock_timestamp() - interval '10 minutes';
    IF EXISTS (SELECT 1 FROM qbank.practice_submissions
               WHERE actor_id = caller.actor_id AND lifecycle_state = 'queued') THEN
        RAISE EXCEPTION 'wait for your last run to finish' USING ERRCODE = '55000';
    END IF;
    IF (SELECT count(*) FROM qbank.practice_submissions WHERE lifecycle_state = 'queued') >= 12 THEN
        RAISE EXCEPTION 'practice is busy right now; try again in a minute' USING ERRCODE = '55000';
    END IF;

    INSERT INTO qbank.practice_submissions (id, tenant_id, actor_id, question_id, question_version_id, mode,
                                            custom_input, language_key, source_object_key, source_checksum,
                                            source_key_reference)
    VALUES (p_id, caller.tenant_id, caller.actor_id, p_question_id, version.id, p_mode, p_custom_input,
            p_language_key, p_source_object_key, lower(p_source_checksum), p_source_key_reference);
    RETURN jsonb_build_object(
        'bundle_object_key', CASE WHEN p_mode = 'submit' THEN version.evaluation_bundle_object_key ELSE sample.object_key END,
        'bundle_checksum', lower(CASE WHEN p_mode = 'submit' THEN version.evaluation_bundle_checksum::text ELSE sample.checksum::text END),
        'bundle_key_reference', CASE WHEN p_mode = 'submit' THEN version.encryption_key_reference ELSE sample.encryption_key_reference END,
        'time_limit_ms', version.time_limit_ms,
        'memory_limit_kib', version.memory_limit_kib
    );
END
$function$;

CREATE FUNCTION qbank.start_practice_mcq_submission(
    p_id uuid,
    p_question_id uuid,
    p_selected integer[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qbank, authz, app
AS $function$
DECLARE
    caller record;
    version qbank.question_versions%ROWTYPE;
    verdict text;
    choice_count integer;
BEGIN
    SELECT * INTO caller FROM qbank.require_practice_context(true);
    version := qbank.practice_version(p_question_id);
    IF version.id IS NULL THEN
        RAISE EXCEPTION 'practice problem was not found' USING ERRCODE = 'P0002';
    END IF;
    IF version.kind <> 'mcq' THEN
        RAISE EXCEPTION 'not a multiple-choice practice problem' USING ERRCODE = '22023';
    END IF;
    IF p_selected IS NULL OR cardinality(p_selected) < 1 THEN
        RAISE EXCEPTION 'pick at least one option' USING ERRCODE = '22023';
    END IF;
    choice_count := jsonb_array_length(version.choices);
    IF EXISTS (SELECT 1 FROM unnest(p_selected) AS pick WHERE pick < 0 OR pick >= choice_count) THEN
        RAISE EXCEPTION 'option index is out of range' USING ERRCODE = '22023';
    END IF;
    IF NOT version.multiple_choice AND cardinality(p_selected) <> 1 THEN
        RAISE EXCEPTION 'only one option may be chosen' USING ERRCODE = '22023';
    END IF;
    IF (SELECT count(DISTINCT pick) FROM unnest(p_selected) AS pick) <> cardinality(p_selected) THEN
        RAISE EXCEPTION 'each option may be chosen once' USING ERRCODE = '22023';
    END IF;

    verdict := CASE
        WHEN (SELECT array_agg(value ORDER BY value) FROM unnest(p_selected) AS value)
           = (SELECT array_agg(value ORDER BY value) FROM unnest(version.correct_choices) AS value)
        THEN 'accepted' ELSE 'wrong_answer' END;

    INSERT INTO qbank.practice_submissions (
        id, tenant_id, actor_id, question_id, question_version_id, mode, custom_input,
        selected_choices, lifecycle_state, verdict, units, completed_at
    )
    VALUES (
        p_id, caller.tenant_id, caller.actor_id, p_question_id, version.id, 'submit', false,
        p_selected, 'completed', verdict, '[]'::jsonb, clock_timestamp()
    );
    RETURN jsonb_build_object('id', p_id);
END
$function$;

CREATE OR REPLACE FUNCTION qbank.get_practice_submission(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, qbank, authz, app
AS $function$
DECLARE
    caller record;
    found_row qbank.practice_submissions%ROWTYPE;
    version qbank.question_versions%ROWTYPE;
    result jsonb;
BEGIN
    SELECT * INTO caller FROM qbank.require_practice_context(false);
    SELECT * INTO found_row FROM qbank.practice_submissions WHERE id = p_id AND actor_id = caller.actor_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'practice run was not found' USING ERRCODE = 'P0002';
    END IF;
    result := qbank.practice_submission_json(found_row);
    IF found_row.selected_choices IS NOT NULL THEN
        SELECT * INTO version FROM qbank.question_versions WHERE id = found_row.question_version_id;
        result := result
            || jsonb_build_object('kind', 'mcq', 'selected_choices', to_jsonb(found_row.selected_choices));
        IF found_row.lifecycle_state = 'completed' AND found_row.mode = 'submit' THEN
            result := result || jsonb_build_object(
                'choices', version.choices,
                'multiple_choice', version.multiple_choice,
                'correct_choices', to_jsonb(version.correct_choices),
                'choice_explanations', version.choice_explanations
            );
        END IF;
        RETURN result;
    END IF;
    RETURN result || jsonb_build_object('source', jsonb_build_object(
        'object_key', found_row.source_object_key, 'checksum', found_row.source_checksum::text,
        'encryption_key_reference', found_row.source_key_reference));
END
$function$;

REVOKE ALL ON FUNCTION qbank.start_practice_mcq_submission(uuid, uuid, integer[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION qbank.start_practice_mcq_submission(uuid, uuid, integer[]) TO aether_question_bank_app;