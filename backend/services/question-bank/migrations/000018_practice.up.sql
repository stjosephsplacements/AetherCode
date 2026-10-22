-- Practice problems (ADR-0041). Staff mark each question for tests or for
-- practice; students see only practice questions, never a test question, and
-- run or submit code on them outside any exam. A student's request carries a
-- tenant-scoped capability for exactly one resource, qbank.practice_submissions,
-- which no staff function or RLS policy accepts (they all require a global
-- context), and every practice function binds rows to the signed actor.
SET ROLE aether_question_bank_owner;

ALTER TABLE qbank.questions
    ADD COLUMN audience text NOT NULL DEFAULT 'test' CHECK (audience IN ('test', 'practice'));
CREATE INDEX questions_practice_idx ON qbank.questions (id) WHERE audience = 'practice';

-- Staff responses carry the audience.
CREATE OR REPLACE FUNCTION qbank.question_response(p_question_id uuid, p_question_version_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, qbank
AS $function$
    SELECT jsonb_build_object(
        'question', jsonb_build_object(
            'id', question.id,
            'slug', question.slug,
            'lifecycle_state', question.lifecycle_state,
            'created_at', question.created_at,
            'archived_at', question.archived_at,
            'version', question.version,
            'audience', question.audience
        ),
        'question_version', qbank.question_version_summary(p_question_version_id)
    )
    FROM qbank.questions AS question
    WHERE question.id = p_question_id
$function$;

-- Versions carry their question's audience too, for the staff editor.
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
        'multiple_choice', question_version.multiple_choice,
        'audience', (SELECT question.audience FROM qbank.questions AS question WHERE question.id = question_version.question_id)
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

-- Moves a question between tests and practice. Returns the new audience.
CREATE FUNCTION qbank.set_question_audience(p_question_id uuid, p_audience text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qbank, authz, app
AS $function$
BEGIN
    PERFORM qbank.require_write_context('qbank.questions');
    IF p_audience IS NULL OR p_audience NOT IN ('test', 'practice') THEN
        RAISE EXCEPTION 'audience must be test or practice' USING ERRCODE = '22023';
    END IF;
    UPDATE qbank.questions
    SET audience = p_audience, version = version + CASE WHEN audience = p_audience THEN 0 ELSE 1 END
    WHERE id = p_question_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'question was not found' USING ERRCODE = 'P0002';
    END IF;
    RETURN p_audience;
END
$function$;

-- A signed context may now carry a tenant, but only for practice: a student's
-- capability for qbank.practice_submissions. It is checked by its signature
-- alone, as the User service decided it moments ago; the global projection
-- check still guards every tenant-less (staff) context.
CREATE OR REPLACE FUNCTION authz.set_context(
    p_actor_id uuid, p_tenant_id uuid, p_authz_revision bigint, p_decision text,
    p_capability_id uuid, p_action text, p_resource text, p_issued_at timestamptz, p_expires_at timestamptz,
    p_key_id uuid, p_signature bytea
)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, authz, app, extensions AS $function$
DECLARE signing_key bytea; canonical_envelope text; context_id uuid; context_now timestamptz := clock_timestamp();
BEGIN
    IF p_actor_id IS NULL OR p_authz_revision <= 0 OR p_capability_id IS NULL OR p_key_id IS NULL
       OR (p_tenant_id IS NOT NULL AND p_resource IS DISTINCT FROM 'qbank.practice_submissions')
       OR p_signature IS NULL OR octet_length(p_signature) <> 32 OR p_decision <> 'allow'
       OR p_action !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'
       OR p_resource !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$'
       OR p_issued_at IS NULL OR p_expires_at IS NULL OR p_expires_at <= context_now
       OR p_issued_at > context_now + interval '1 second'
       OR p_issued_at < context_now - interval '5 seconds'
       OR p_expires_at > p_issued_at + interval '5 seconds' THEN
        RAISE EXCEPTION 'invalid signed authorization context' USING ERRCODE = '28000';
    END IF;
    SELECT key_material INTO signing_key FROM authz.context_keys
    WHERE key_id = p_key_id AND audience = current_database() AND not_before <= context_now
      AND not_after > context_now AND retired_at IS NULL;
    canonical_envelope := format(
        'aether-authz-context-v2|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s',
        current_database(), p_key_id, p_capability_id, p_actor_id, COALESCE(p_tenant_id::text, ''), p_authz_revision,
        p_decision, p_action, p_resource,
        to_char(p_issued_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        to_char(p_expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    );
    IF signing_key IS NULL
       OR extensions.hmac(convert_to(canonical_envelope, 'UTF8'), signing_key, 'sha256') <> p_signature THEN
        RAISE EXCEPTION 'invalid signed authorization context' USING ERRCODE = '28000';
    END IF;
    IF p_tenant_id IS NULL AND NOT authz.has_global_authorization_at(p_actor_id, p_authz_revision, false) THEN
        RAISE EXCEPTION 'local authorization projection is not current' USING ERRCODE = '28000';
    END IF;
    PERFORM authz.purge_expired_contexts();
    PERFORM authz.purge_expired_capabilities();
    INSERT INTO authz.consumed_capabilities (capability_id, expires_at)
    VALUES (p_capability_id, p_expires_at)
    ON CONFLICT (capability_id) DO NOTHING;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'authorization capability has already been consumed' USING ERRCODE = '28000';
    END IF;
    context_id := extensions.gen_random_uuid();
    INSERT INTO authz.request_contexts (
        context_id, capability_id, backend_pid, transaction_id, actor_id, tenant_id, authz_revision,
        action, resource, issued_at, expires_at
    ) VALUES (
        context_id, p_capability_id, pg_backend_pid(), txid_current(), p_actor_id, p_tenant_id, p_authz_revision,
        p_action, p_resource, p_issued_at, p_expires_at
    ) ON CONFLICT (capability_id) DO NOTHING
    RETURNING authz.request_contexts.context_id INTO context_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'authorization capability has already been consumed' USING ERRCODE = '28000';
    END IF;
    PERFORM set_config('app.authz_context_id', context_id::text, true);
END
$function$;

-- The student behind the current practice context. Reads accept a read or a
-- write capability; writes need a write capability.
CREATE FUNCTION qbank.require_practice_context(p_write boolean, OUT actor_id uuid, OUT tenant_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz, app
AS $function$
BEGIN
    SELECT context.actor_id, context.tenant_id INTO actor_id, tenant_id
    FROM authz.request_contexts AS context
    WHERE context.context_id = app.current_context_id()
      AND context.backend_pid = pg_backend_pid()
      AND context.transaction_id = txid_current()
      AND context.tenant_id IS NOT NULL
      AND context.resource = 'qbank.practice_submissions'
      AND (context.action = 'qbank.write' OR (NOT p_write AND context.action = 'qbank.read'))
      AND context.expires_at > clock_timestamp();
    IF actor_id IS NULL THEN
        RAISE EXCEPTION 'current authorization context cannot use practice' USING ERRCODE = '42501';
    END IF;
END
$function$;

CREATE TABLE qbank.practice_submissions (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    question_id uuid NOT NULL REFERENCES qbank.questions (id) ON DELETE RESTRICT,
    question_version_id uuid NOT NULL REFERENCES qbank.question_versions (id) ON DELETE RESTRICT,
    mode text NOT NULL CHECK (mode IN ('run', 'submit')),
    custom_input boolean NOT NULL DEFAULT false CHECK (NOT custom_input OR mode = 'run'),
    language_key text NOT NULL CHECK (length(language_key) BETWEEN 1 AND 50),
    source_object_key text NOT NULL CHECK (length(source_object_key) > 0),
    source_checksum char(64) NOT NULL CHECK (source_checksum ~ '^[0-9a-f]{64}$'),
    source_key_reference text NOT NULL CHECK (length(source_key_reference) > 0),
    requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    lifecycle_state text NOT NULL DEFAULT 'queued' CHECK (lifecycle_state IN ('queued', 'completed', 'failed')),
    verdict text,
    units jsonb CHECK (units IS NULL OR jsonb_typeof(units) = 'array'),
    completed_at timestamptz,
    CHECK ((lifecycle_state = 'queued') = (completed_at IS NULL))
);
CREATE INDEX practice_submissions_actor_idx ON qbank.practice_submissions (actor_id, question_id, requested_at DESC);
CREATE INDEX practice_submissions_queued_idx ON qbank.practice_submissions (requested_at) WHERE lifecycle_state = 'queued';
ALTER TABLE qbank.practice_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE qbank.practice_submissions FORCE ROW LEVEL SECURITY;
CREATE POLICY qbank_practice_submissions_owner_maintenance ON qbank.practice_submissions
    FOR ALL TO aether_question_bank_owner USING (true) WITH CHECK (true);

-- The latest published version of a practice question, or NULL. Only coding
-- questions are practised.
CREATE FUNCTION qbank.practice_version(p_question_id uuid)
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
      AND version.kind = 'coding'
    ORDER BY version.version_number DESC
    LIMIT 1
$function$;

CREATE FUNCTION qbank.version_tag_names(p_question_version_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, qbank
AS $function$
    SELECT COALESCE(jsonb_agg(tag.name ORDER BY tag.name), '[]'::jsonb)
    FROM qbank.question_version_tags AS version_tag
    JOIN qbank.tags AS tag ON tag.id = version_tag.tag_id
    WHERE version_tag.question_version_id = p_question_version_id
$function$;

-- The practice catalogue with the student's own progress on each problem.
CREATE FUNCTION qbank.list_practice_questions()
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

-- One practice problem. The sample bundle reference is for the service, which
-- decrypts the sample tests and never returns the reference itself.
CREATE FUNCTION qbank.get_practice_question(p_question_id uuid)
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
        'title', version.title,
        'prompt_markdown', version.prompt_markdown,
        'difficulty', version.difficulty,
        'languages', version.supported_languages,
        'time_limit_ms', version.time_limit_ms,
        'memory_limit_kib', version.memory_limit_kib,
        'tags', qbank.version_tag_names(version.id),
        'sample', CASE WHEN sample.id IS NULL THEN NULL ELSE jsonb_build_object(
            'object_key', sample.object_key, 'checksum', lower(sample.checksum::text),
            'encryption_key_reference', sample.encryption_key_reference) END
    );
END
$function$;

-- Records a run (sample tests, or the student's own input) or a submission
-- (every test) and returns what Judge needs. A student has one job in flight,
-- and practice holds at most 12 of Judge's slots so exams keep the rest.
-- Jobs Judge has not finished in 10 minutes stop counting and are failed.
CREATE FUNCTION qbank.start_practice_submission(
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

CREATE FUNCTION qbank.practice_submission_json(p_row qbank.practice_submissions)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog, qbank
AS $function$
    SELECT jsonb_build_object(
        'id', p_row.id, 'question_id', p_row.question_id, 'mode', p_row.mode,
        'custom_input', p_row.custom_input, 'language', p_row.language_key,
        'lifecycle_state', p_row.lifecycle_state, 'verdict', p_row.verdict,
        'units', COALESCE(p_row.units, '[]'::jsonb),
        'passed_units', (SELECT count(*) FROM jsonb_array_elements(COALESCE(p_row.units, '[]'::jsonb)) AS unit
                         WHERE unit ->> 'verdict' = 'accepted'),
        'total_units', jsonb_array_length(COALESCE(p_row.units, '[]'::jsonb)),
        'requested_at', p_row.requested_at, 'completed_at', p_row.completed_at
    )
$function$;

-- The student's last 20 runs and submissions on a problem, newest first.
CREATE FUNCTION qbank.list_practice_submissions(p_question_id uuid)
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
        SELECT jsonb_agg(qbank.practice_submission_json(recent) ORDER BY recent.requested_at DESC)
        FROM (SELECT * FROM qbank.practice_submissions
              WHERE actor_id = caller.actor_id AND question_id = p_question_id
              ORDER BY requested_at DESC LIMIT 20) AS recent
    ), '[]'::jsonb);
END
$function$;

-- One of the student's own runs, with its source reference for the service.
CREATE FUNCTION qbank.get_practice_submission(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, qbank, authz, app
AS $function$
DECLARE
    caller record;
    found_row qbank.practice_submissions%ROWTYPE;
BEGIN
    SELECT * INTO caller FROM qbank.require_practice_context(false);
    SELECT * INTO found_row FROM qbank.practice_submissions WHERE id = p_id AND actor_id = caller.actor_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'practice run was not found' USING ERRCODE = 'P0002';
    END IF;
    RETURN qbank.practice_submission_json(found_row) || jsonb_build_object('source', jsonb_build_object(
        'object_key', found_row.source_object_key, 'checksum', found_row.source_checksum::text,
        'encryption_key_reference', found_row.source_key_reference));
END
$function$;

-- The student's practice totals, for their progress page.
CREATE FUNCTION qbank.get_practice_progress()
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
    RETURN (
        WITH catalogue AS (
            SELECT question.id, version.difficulty
            FROM qbank.questions AS question
            CROSS JOIN LATERAL qbank.practice_version(question.id) AS version
            WHERE question.audience = 'practice' AND version.id IS NOT NULL
        ), solved AS (
            SELECT DISTINCT question_id FROM qbank.practice_submissions
            WHERE actor_id = caller.actor_id AND mode = 'submit' AND verdict = 'accepted'
        )
        SELECT jsonb_build_object(
            'available', (SELECT count(*) FROM catalogue),
            'solved', (SELECT count(*) FROM catalogue JOIN solved ON solved.question_id = catalogue.id),
            'by_difficulty', (SELECT COALESCE(jsonb_object_agg(level, jsonb_build_object('available', available, 'solved', solved_count)), '{}'::jsonb)
                              FROM (SELECT catalogue.difficulty AS level, count(*) AS available,
                                           count(solved.question_id) AS solved_count
                                    FROM catalogue LEFT JOIN solved ON solved.question_id = catalogue.id
                                    GROUP BY catalogue.difficulty) AS levels),
            'submissions', (SELECT count(*) FROM qbank.practice_submissions
                            WHERE actor_id = caller.actor_id AND mode = 'submit'),
            'accepted', (SELECT count(*) FROM qbank.practice_submissions
                         WHERE actor_id = caller.actor_id AND mode = 'submit' AND verdict = 'accepted'),
            'active_days', (SELECT COALESCE(jsonb_agg(day ORDER BY day), '[]'::jsonb) FROM (
                SELECT DISTINCT (requested_at AT TIME ZONE 'Asia/Kolkata')::date AS day
                FROM qbank.practice_submissions
                WHERE actor_id = caller.actor_id AND requested_at > clock_timestamp() - interval '365 days') AS days)
        )
    );
END
$function$;

-- The completion worker records Judge's verdicts; false for an unknown id.
CREATE FUNCTION qbank.finish_practice_submission(p_id uuid, p_lifecycle_state text, p_verdict text, p_units jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qbank
AS $function$
BEGIN
    IF p_lifecycle_state NOT IN ('completed', 'failed') THEN
        RAISE EXCEPTION 'invalid practice state' USING ERRCODE = '22023';
    END IF;
    UPDATE qbank.practice_submissions
    SET lifecycle_state = p_lifecycle_state, verdict = p_verdict,
        units = COALESCE(p_units, '[]'::jsonb), completed_at = clock_timestamp()
    WHERE id = p_id AND lifecycle_state = 'queued';
    RETURN EXISTS (SELECT 1 FROM qbank.practice_submissions WHERE id = p_id);
END
$function$;

REVOKE ALL ON FUNCTION qbank.set_question_audience(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION qbank.require_practice_context(boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION qbank.practice_version(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION qbank.version_tag_names(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION qbank.list_practice_questions() FROM PUBLIC;
REVOKE ALL ON FUNCTION qbank.get_practice_question(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION qbank.start_practice_submission(uuid, uuid, text, text, boolean, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION qbank.practice_submission_json(qbank.practice_submissions) FROM PUBLIC;
REVOKE ALL ON FUNCTION qbank.list_practice_submissions(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION qbank.get_practice_submission(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION qbank.get_practice_progress() FROM PUBLIC;
REVOKE ALL ON FUNCTION qbank.finish_practice_submission(uuid, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION qbank.set_question_audience(uuid, text) TO aether_question_bank_app;
GRANT EXECUTE ON FUNCTION qbank.list_practice_questions() TO aether_question_bank_app;
GRANT EXECUTE ON FUNCTION qbank.get_practice_question(uuid) TO aether_question_bank_app;
GRANT EXECUTE ON FUNCTION qbank.start_practice_submission(uuid, uuid, text, text, boolean, text, text, text) TO aether_question_bank_app;
GRANT EXECUTE ON FUNCTION qbank.list_practice_submissions(uuid) TO aether_question_bank_app;
GRANT EXECUTE ON FUNCTION qbank.get_practice_submission(uuid) TO aether_question_bank_app;
GRANT EXECUTE ON FUNCTION qbank.get_practice_progress() TO aether_question_bank_app;
GRANT EXECUTE ON FUNCTION qbank.finish_practice_submission(uuid, text, text, jsonb) TO aether_question_bank_projection_worker;

RESET ROLE;
