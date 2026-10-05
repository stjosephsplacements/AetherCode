-- Candidate runs against an exam item's sample tests (ADR-0021).
--
-- A candidate starts a run on an item of their own active attempt up to the
-- deadline plus answer_grace(). At most two runs per attempt may be in flight,
-- as in the exam app. The dispatcher claims queued runs with the same leases
-- as evaluation requests and sends Judge the item's sample bundle, whose job
-- returns each test's output. The completion bridge asks code_run_for_job
-- whether a completion belongs to a run and, if so, records the run's units
-- with record_code_run_completion. Nothing here writes evaluation requests,
-- Judge receipts or score summaries.
--
-- A refusal a candidate should read carries DETAIL 'candidate: <message>'.
SET ROLE aether_submission_owner;

ALTER TABLE submission.code_runs
    ADD COLUMN dispatch_attempts integer NOT NULL DEFAULT 0 CHECK (dispatch_attempts >= 0),
    ADD COLUMN dispatch_after timestamptz,
    ADD COLUMN dispatched_at timestamptz,
    ADD COLUMN verdict text CHECK (verdict IS NULL OR verdict IN (
        'accepted', 'wrong_answer', 'time_limit_exceeded', 'memory_limit_exceeded',
        'runtime_error', 'compile_error', 'internal_error', 'cancelled'
    )),
    ADD COLUMN failure_code text CHECK (failure_code IS NULL OR length(failure_code) BETWEEN 1 AND 80),
    ADD CONSTRAINT code_runs_dispatched_at_check
        CHECK (lifecycle_state <> 'dispatched' OR dispatched_at IS NOT NULL);

ALTER TABLE submission.code_run_units
    ADD COLUMN stdin text,
    ADD COLUMN compile_output text;

CREATE INDEX code_runs_dispatch_idx
    ON submission.code_runs (created_at)
    WHERE lifecycle_state = 'queued';
CREATE UNIQUE INDEX code_runs_judge_job_idx
    ON submission.code_runs (judge_job_id)
    WHERE judge_job_id IS NOT NULL;

CREATE FUNCTION submission.start_code_run(
    p_run_id uuid,
    p_tenant_id uuid,
    p_attempt_id uuid,
    p_exam_item_id uuid,
    p_language_id text,
    p_source_object_key text,
    p_source_checksum text,
    p_encryption_key_reference text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz, submission
AS $function$
DECLARE
    actor_id uuid;
    attempt_record submission.attempts%ROWTYPE;
    item_record submission.assignment_item_projections%ROWTYPE;
    in_flight integer;
    run_record submission.code_runs%ROWTYPE;
BEGIN
    PERFORM submission.require_authorized_context(p_tenant_id, 'submission.write', 'submission.attempts');
    actor_id := authz.current_context_actor_id();
    IF p_run_id IS NULL OR p_attempt_id IS NULL OR p_exam_item_id IS NULL OR actor_id IS NULL
       OR p_language_id IS NULL OR length(p_language_id) NOT BETWEEN 1 AND 80
       OR p_source_object_key IS NULL OR length(p_source_object_key) = 0
       OR p_source_checksum !~* '^[0-9a-f]{64}$'
       OR p_encryption_key_reference IS NULL OR length(p_encryption_key_reference) = 0
    THEN
        RAISE EXCEPTION 'code run command is invalid' USING ERRCODE = '22023';
    END IF;

    -- Locking the attempt serializes concurrent runs, so the in-flight count
    -- below cannot be raced past.
    SELECT * INTO attempt_record
    FROM submission.attempts
    WHERE tenant_id = p_tenant_id AND id = p_attempt_id AND deleted_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'candidate attempt was not found' USING ERRCODE = 'P0001';
    END IF;
    IF attempt_record.candidate_id <> actor_id THEN
        RAISE EXCEPTION 'attempt belongs to another candidate' USING ERRCODE = '42501';
    END IF;
    IF attempt_record.lifecycle_state <> 'active'
       OR clock_timestamp() >= attempt_record.submission_deadline + submission.answer_grace() THEN
        RAISE EXCEPTION 'attempt is no longer open' USING ERRCODE = '55000',
            DETAIL = 'candidate: The exam has ended for this attempt.';
    END IF;

    SELECT * INTO item_record
    FROM submission.assignment_item_projections
    WHERE tenant_id = p_tenant_id
      AND candidate_assignment_id = attempt_record.candidate_assignment_id
      AND exam_item_id = p_exam_item_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'exam item was not found' USING ERRCODE = 'P0001';
    END IF;
    IF item_record.sample_bundle_object_key IS NULL OR item_record.time_limit_ms IS NULL THEN
        RAISE EXCEPTION 'exam item has no sample bundle' USING ERRCODE = '55000',
            DETAIL = 'candidate: This question has no sample tests to run.';
    END IF;
    IF NOT (p_language_id = ANY (item_record.supported_languages)) THEN
        RAISE EXCEPTION 'language is not supported by this exam item' USING ERRCODE = '22023';
    END IF;

    SELECT count(*) INTO in_flight
    FROM submission.code_runs
    WHERE tenant_id = p_tenant_id
      AND attempt_id = p_attempt_id
      AND lifecycle_state IN ('queued', 'dispatched');
    IF in_flight >= 2 THEN
        RAISE EXCEPTION 'too many runs in flight' USING ERRCODE = '55000',
            DETAIL = 'candidate: Your previous run is still being judged. Wait for it to finish.';
    END IF;

    INSERT INTO submission.code_runs (
        id, tenant_id, attempt_id, exam_item_id, candidate_id, language_id,
        source_object_key, source_checksum, encryption_key_reference, purge_after
    ) VALUES (
        p_run_id, p_tenant_id, p_attempt_id, p_exam_item_id, actor_id, p_language_id,
        p_source_object_key, lower(p_source_checksum), p_encryption_key_reference,
        clock_timestamp() + interval '30 days'
    ) RETURNING * INTO run_record;

    RETURN jsonb_build_object(
        'id', run_record.id,
        'attempt_id', run_record.attempt_id,
        'exam_item_id', run_record.exam_item_id,
        'language_id', run_record.language_id,
        'lifecycle_state', run_record.lifecycle_state,
        'created_at', run_record.created_at
    );
END
$function$;

-- One run with every unit's input, expected output and output. Sample tests
-- are not confidential, so nothing is redacted (ADR-0021).
CREATE FUNCTION submission.get_code_run(
    p_tenant_id uuid,
    p_attempt_id uuid,
    p_run_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, authz, submission
AS $function$
DECLARE
    actor_id uuid;
    response jsonb;
BEGIN
    IF NOT authz.current_context_allows_read(
        p_tenant_id, 'submission.read', 'submission.write', 'submission.attempts'
    ) THEN
        RAISE EXCEPTION 'signed authorization context does not allow this submission operation'
            USING ERRCODE = '42501';
    END IF;
    actor_id := authz.current_context_actor_id();
    IF actor_id IS NULL THEN
        RAISE EXCEPTION 'code run reader is invalid' USING ERRCODE = '42501';
    END IF;

    SELECT jsonb_build_object(
        'id', run_row.id,
        'attempt_id', run_row.attempt_id,
        'exam_item_id', run_row.exam_item_id,
        'language_id', run_row.language_id,
        'lifecycle_state', run_row.lifecycle_state,
        'verdict', run_row.verdict,
        'created_at', run_row.created_at,
        'completed_at', run_row.completed_at,
        'units', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'unit_number', unit_row.unit_number,
                'verdict', unit_row.verdict,
                'stdin', unit_row.stdin,
                'expected_output', unit_row.expected_output,
                'stdout', unit_row.stdout,
                'stderr', unit_row.stderr,
                'compile_output', unit_row.compile_output,
                'execution_time_ms', unit_row.execution_time_ms,
                'memory_kib', unit_row.memory_kib
            ) ORDER BY unit_row.unit_number)
            FROM submission.code_run_units AS unit_row
            WHERE unit_row.tenant_id = run_row.tenant_id AND unit_row.code_run_id = run_row.id
        ), '[]'::jsonb)
    ) INTO response
    FROM submission.code_runs AS run_row
    JOIN submission.attempts AS attempt_row
      ON attempt_row.tenant_id = run_row.tenant_id AND attempt_row.id = run_row.attempt_id
    WHERE run_row.tenant_id = p_tenant_id
      AND run_row.attempt_id = p_attempt_id
      AND run_row.id = p_run_id
      AND attempt_row.candidate_id = actor_id
      AND attempt_row.deleted_at IS NULL;
    IF response IS NULL THEN
        RAISE EXCEPTION 'code run was not found' USING ERRCODE = 'P0001';
    END IF;
    RETURN response;
END
$function$;

-- The candidate's runs of one item, newest first, without unit detail.
CREATE FUNCTION submission.list_code_runs(
    p_tenant_id uuid,
    p_attempt_id uuid,
    p_exam_item_id uuid,
    p_limit integer,
    p_cursor_created_at timestamptz,
    p_cursor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, authz, submission
AS $function$
DECLARE
    actor_id uuid;
    response jsonb;
BEGIN
    IF NOT authz.current_context_allows_read(
        p_tenant_id, 'submission.read', 'submission.write', 'submission.attempts'
    ) THEN
        RAISE EXCEPTION 'signed authorization context does not allow this submission operation'
            USING ERRCODE = '42501';
    END IF;
    actor_id := authz.current_context_actor_id();
    IF actor_id IS NULL THEN
        RAISE EXCEPTION 'code run reader is invalid' USING ERRCODE = '42501';
    END IF;
    -- 101 accommodates the caller's limit+1 probe for next-page detection.
    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 101 OR p_exam_item_id IS NULL THEN
        RAISE EXCEPTION 'code run listing is invalid' USING ERRCODE = '22023';
    END IF;
    IF (p_cursor_created_at IS NULL) <> (p_cursor_id IS NULL) THEN
        RAISE EXCEPTION 'code run listing cursor must supply both parts' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM submission.attempts
        WHERE tenant_id = p_tenant_id AND id = p_attempt_id AND candidate_id = actor_id AND deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'candidate attempt was not found' USING ERRCODE = 'P0001';
    END IF;

    SELECT COALESCE(jsonb_agg(page.run ORDER BY page.created_at DESC, page.id DESC), '[]'::jsonb)
    INTO response
    FROM (
        SELECT run_row.id, run_row.created_at, jsonb_build_object(
            'id', run_row.id,
            'attempt_id', run_row.attempt_id,
            'exam_item_id', run_row.exam_item_id,
            'language_id', run_row.language_id,
            'lifecycle_state', run_row.lifecycle_state,
            'verdict', run_row.verdict,
            'passed_units', (SELECT count(*) FROM submission.code_run_units AS unit_row
                             WHERE unit_row.tenant_id = run_row.tenant_id AND unit_row.code_run_id = run_row.id
                               AND unit_row.verdict = 'accepted'),
            'total_units', (SELECT count(*) FROM submission.code_run_units AS unit_row
                            WHERE unit_row.tenant_id = run_row.tenant_id AND unit_row.code_run_id = run_row.id),
            'created_at', run_row.created_at,
            'completed_at', run_row.completed_at
        ) AS run
        FROM submission.code_runs AS run_row
        WHERE run_row.tenant_id = p_tenant_id
          AND run_row.attempt_id = p_attempt_id
          AND run_row.exam_item_id = p_exam_item_id
          AND (p_cursor_created_at IS NULL OR (run_row.created_at, run_row.id) < (p_cursor_created_at, p_cursor_id))
        ORDER BY run_row.created_at DESC, run_row.id DESC
        LIMIT p_limit
    ) AS page;
    RETURN response;
END
$function$;

-- The dispatcher's claim, mirroring claim_evaluation_requests: leases that
-- double per attempt up to five minutes, and NULL settings on an item that
-- cannot run so the dispatcher can fail it.
CREATE FUNCTION submission.claim_code_runs(
    p_limit integer,
    p_lease_seconds integer
)
RETURNS TABLE (
    code_run_id uuid,
    tenant_id uuid,
    sample_bundle_object_key text,
    sample_bundle_checksum text,
    sample_bundle_key_reference text,
    source_object_key text,
    source_checksum text,
    source_key_reference text,
    language_id text,
    time_limit_ms integer,
    memory_limit_kib integer,
    expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, submission
AS $function$
BEGIN
    IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
       OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 5 AND 300 THEN
        RAISE EXCEPTION 'code run claim limits are invalid' USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    WITH due AS (
        SELECT run_row.id
        FROM submission.code_runs AS run_row
        WHERE run_row.lifecycle_state = 'queued'
          AND (run_row.dispatch_after IS NULL OR run_row.dispatch_after <= clock_timestamp())
        ORDER BY run_row.created_at
        LIMIT p_limit
        FOR UPDATE OF run_row SKIP LOCKED
    ), claimed AS (
        UPDATE submission.code_runs AS run_row
        SET dispatch_attempts = run_row.dispatch_attempts + 1,
            dispatch_after = clock_timestamp() + make_interval(
                secs => least(p_lease_seconds * power(2, least(run_row.dispatch_attempts, 10)), 300)
            )
        FROM due
        WHERE run_row.id = due.id
        RETURNING run_row.*
    )
    SELECT claimed.id, claimed.tenant_id, COALESCE(item.sample_bundle_object_key, ''),
           COALESCE(item.sample_bundle_checksum::text, ''), item.sample_bundle_key_reference,
           claimed.source_object_key, claimed.source_checksum::text, claimed.encryption_key_reference,
           claimed.language_id, item.time_limit_ms, item.memory_limit_kib,
           claimed.created_at + interval '1 hour'
    FROM claimed
    JOIN submission.attempts AS attempt_row
      ON attempt_row.tenant_id = claimed.tenant_id AND attempt_row.id = claimed.attempt_id
    LEFT JOIN submission.assignment_item_projections AS item
      ON item.tenant_id = claimed.tenant_id
     AND item.candidate_assignment_id = attempt_row.candidate_assignment_id
     AND item.exam_item_id = claimed.exam_item_id
    ORDER BY claimed.created_at;
END
$function$;

CREATE FUNCTION submission.mark_code_run_dispatched(
    p_tenant_id uuid,
    p_run_id uuid,
    p_judge_job_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, submission
AS $function$
DECLARE
    recorded boolean;
BEGIN
    IF p_tenant_id IS NULL OR p_run_id IS NULL OR p_judge_job_id IS NULL THEN
        RAISE EXCEPTION 'code run dispatch is invalid' USING ERRCODE = '22023';
    END IF;
    UPDATE submission.code_runs
    SET judge_job_id = p_judge_job_id,
        lifecycle_state = CASE WHEN lifecycle_state = 'queued' THEN 'dispatched' ELSE lifecycle_state END,
        dispatched_at = CASE WHEN lifecycle_state = 'queued' THEN clock_timestamp() ELSE dispatched_at END
    WHERE tenant_id = p_tenant_id AND id = p_run_id AND judge_job_id IS NULL
    RETURNING true INTO recorded;
    RETURN COALESCE(recorded, false);
END
$function$;

CREATE FUNCTION submission.mark_code_run_failed(
    p_tenant_id uuid,
    p_run_id uuid,
    p_failure_code text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, submission
AS $function$
DECLARE
    failed boolean;
BEGIN
    IF p_tenant_id IS NULL OR p_run_id IS NULL OR p_failure_code IS NULL
       OR length(p_failure_code) NOT BETWEEN 1 AND 80 THEN
        RAISE EXCEPTION 'code run failure is invalid' USING ERRCODE = '22023';
    END IF;
    UPDATE submission.code_runs
    SET lifecycle_state = 'failed', verdict = 'internal_error', failure_code = p_failure_code,
        completed_at = clock_timestamp()
    WHERE tenant_id = p_tenant_id AND id = p_run_id AND lifecycle_state = 'queued'
    RETURNING true INTO failed;
    RETURN COALESCE(failed, false);
END
$function$;

-- Tells the completion bridge whether a Judge job belongs to a run.
CREATE FUNCTION submission.code_run_for_job(p_judge_job_id uuid)
RETURNS TABLE (tenant_id uuid, code_run_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, submission
AS $function$
    SELECT run_row.tenant_id, run_row.id
    FROM submission.code_runs AS run_row
    WHERE run_row.judge_job_id = p_judge_job_id
$function$;

-- Records a run's completion with each unit's decrypted output. A replay of
-- an already terminal run changes nothing and returns false.
CREATE FUNCTION submission.record_code_run_completion(
    p_tenant_id uuid,
    p_run_id uuid,
    p_judge_job_id uuid,
    p_verdict text,
    p_units jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, submission
AS $function$
DECLARE
    run_record submission.code_runs%ROWTYPE;
BEGIN
    IF p_tenant_id IS NULL OR p_run_id IS NULL OR p_judge_job_id IS NULL
       OR p_verdict NOT IN ('accepted', 'wrong_answer', 'time_limit_exceeded', 'memory_limit_exceeded',
                            'runtime_error', 'compile_error', 'internal_error', 'cancelled')
       OR jsonb_typeof(p_units) <> 'array' OR jsonb_array_length(p_units) > 1000 THEN
        RAISE EXCEPTION 'code run completion is invalid' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO run_record
    FROM submission.code_runs
    WHERE tenant_id = p_tenant_id AND id = p_run_id
    FOR UPDATE;
    IF NOT FOUND OR run_record.judge_job_id IS DISTINCT FROM p_judge_job_id THEN
        RAISE EXCEPTION 'code run completion does not match a dispatched run' USING ERRCODE = '22023';
    END IF;
    IF run_record.lifecycle_state IN ('completed', 'failed', 'cancelled') THEN
        RETURN false;
    END IF;

    INSERT INTO submission.code_run_units (
        id, tenant_id, code_run_id, unit_number, verdict, stdin, expected_output,
        stdout, stderr, compile_output, execution_time_ms, memory_kib
    )
    SELECT extensions.gen_random_uuid(), p_tenant_id, p_run_id, unit.unit_number, unit.verdict,
           unit.stdin, unit.expected_output, unit.stdout, unit.stderr, unit.compile_output,
           unit.execution_time_ms, unit.memory_kib
    FROM jsonb_to_recordset(p_units) AS unit(
        unit_number integer,
        verdict text,
        stdin text,
        expected_output text,
        stdout text,
        stderr text,
        compile_output text,
        execution_time_ms integer,
        memory_kib integer
    );

    UPDATE submission.code_runs
    SET lifecycle_state = 'completed', verdict = p_verdict, completed_at = clock_timestamp(),
        dispatched_at = COALESCE(dispatched_at, clock_timestamp())
    WHERE tenant_id = p_tenant_id AND id = p_run_id;
    RETURN true;
END
$function$;

REVOKE ALL ON FUNCTION submission.start_code_run(uuid, uuid, uuid, uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION submission.get_code_run(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION submission.list_code_runs(uuid, uuid, uuid, integer, timestamptz, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION submission.claim_code_runs(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION submission.mark_code_run_dispatched(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION submission.mark_code_run_failed(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION submission.code_run_for_job(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION submission.record_code_run_completion(uuid, uuid, uuid, text, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
    submission.start_code_run(uuid, uuid, uuid, uuid, text, text, text, text),
    submission.get_code_run(uuid, uuid, uuid),
    submission.list_code_runs(uuid, uuid, uuid, integer, timestamptz, uuid)
    TO aether_submission_app;
GRANT EXECUTE ON FUNCTION
    submission.claim_code_runs(integer, integer),
    submission.mark_code_run_dispatched(uuid, uuid, uuid),
    submission.mark_code_run_failed(uuid, uuid, text),
    submission.code_run_for_job(uuid),
    submission.record_code_run_completion(uuid, uuid, uuid, text, jsonb)
    TO aether_submission_judge_adapter;

RESET ROLE;
