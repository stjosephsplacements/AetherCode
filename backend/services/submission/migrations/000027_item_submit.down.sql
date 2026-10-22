SET ROLE aether_submission_owner;

DROP FUNCTION submission.start_custom_run(uuid, uuid, uuid, uuid, text, text, text, text, text, text, text);
DELETE FROM submission.code_run_units WHERE code_run_id IN (SELECT id FROM submission.code_runs WHERE kind = 'custom');
DELETE FROM submission.code_runs WHERE kind = 'custom';

CREATE OR REPLACE FUNCTION submission.claim_code_runs(
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

DROP FUNCTION submission.list_item_submissions_for_candidate(uuid, uuid, uuid);
DROP FUNCTION submission.submit_item(uuid, uuid, uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION submission.expire_overdue_attempts(p_limit integer DEFAULT 500)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, submission, app
AS $function$
DECLARE
    expired_count integer := 0;
    attempt_row   submission.attempts%ROWTYPE;
    request_count integer;
    event_payload jsonb;
BEGIN
    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 5000 THEN
        RAISE EXCEPTION 'expiry batch limit must be between 1 and 5000' USING ERRCODE = '22023';
    END IF;

    FOR attempt_row IN
        SELECT *
        FROM submission.attempts
        WHERE lifecycle_state IN ('created', 'active')
          AND submission_deadline + submission.answer_grace() < clock_timestamp()
          AND deleted_at IS NULL
        ORDER BY submission_deadline
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    LOOP
        -- The latest revision of every answered item becomes a queued
        -- evaluation request, as submit_attempt records it, and is announced
        -- with the payload the service writes for a candidate's own submit.
        WITH latest AS (
            SELECT DISTINCT ON (revision.exam_item_id) revision.id, revision.exam_item_id
            FROM submission.answer_revisions AS revision
            WHERE revision.tenant_id = attempt_row.tenant_id
              AND revision.attempt_id = attempt_row.id
            ORDER BY revision.exam_item_id, revision.revision_number DESC
        ), inserted AS (
            INSERT INTO submission.evaluation_requests (
                id, tenant_id, attempt_id, answer_revision_id,
                evaluation_bundle_object_key, evaluation_bundle_checksum,
                caller_idempotency_key, maximum_score
            )
            SELECT pg_catalog.uuidv7(), attempt_row.tenant_id, attempt_row.id, latest.id,
                   item.evaluation_bundle_object_key, item.evaluation_bundle_checksum,
                   'time-up:' || latest.id::text, item.maximum_score
            FROM latest
            JOIN submission.assignment_item_projections AS item
              ON item.tenant_id = attempt_row.tenant_id
             AND item.candidate_assignment_id = attempt_row.candidate_assignment_id
             AND item.exam_item_id = latest.exam_item_id
            RETURNING id, answer_revision_id, evaluation_bundle_object_key, evaluation_bundle_checksum,
                      caller_idempotency_key, maximum_score
        ), announced AS (
            SELECT inserted.id, jsonb_build_object(
                'evaluation_request_id', inserted.id,
                'attempt_id', attempt_row.id,
                'answer_revision_id', inserted.answer_revision_id,
                'exam_item_id', latest.exam_item_id,
                'evaluation_bundle_object_key', inserted.evaluation_bundle_object_key,
                'evaluation_bundle_checksum', inserted.evaluation_bundle_checksum,
                'maximum_score', inserted.maximum_score,
                'caller_idempotency_key', inserted.caller_idempotency_key
            ) AS payload
            FROM inserted
            JOIN latest ON latest.id = inserted.answer_revision_id
        )
        INSERT INTO app.outbox_events (
            event_id, aggregate_type, aggregate_id, tenant_id, event_type,
            schema_version, payload, payload_sha256, occurred_at
        )
        SELECT pg_catalog.uuidv7(), 'evaluation_request', announced.id, attempt_row.tenant_id,
               'submission.evaluation_requested.v1', 1, announced.payload,
               extensions.digest(convert_to(announced.payload::text, 'UTF8'), 'sha256'), clock_timestamp()
        FROM announced;
        GET DIAGNOSTICS request_count = ROW_COUNT;

        IF request_count = 0 THEN
            UPDATE submission.attempts
            SET lifecycle_state = 'expired',
                completed_at    = COALESCE(completed_at, CURRENT_TIMESTAMP),
                version         = version + 1
            WHERE id = attempt_row.id;

            event_payload := jsonb_build_object(
                'attempt_id',      attempt_row.id,
                'tenant_id',       attempt_row.tenant_id,
                'exam_id',         attempt_row.exam_id,
                'exam_version_id', attempt_row.exam_version_id,
                'candidate_id',    attempt_row.candidate_id,
                'expired_at',      CURRENT_TIMESTAMP
            );
            INSERT INTO app.outbox_events (
                event_id, aggregate_type, aggregate_id, tenant_id, event_type,
                schema_version, payload, payload_sha256, occurred_at
            ) VALUES (
                pg_catalog.uuidv7(), 'attempt', attempt_row.id, attempt_row.tenant_id,
                'submission.attempt_expired.v1', 1, event_payload,
                extensions.digest(convert_to(event_payload::text, 'UTF8'), 'sha256'), CURRENT_TIMESTAMP
            );
        ELSE
            UPDATE submission.attempts
            SET lifecycle_state = 'grading',
                submitted_at    = clock_timestamp(),
                version         = version + 1
            WHERE id = attempt_row.id
            RETURNING * INTO attempt_row;

            INSERT INTO submission.attempt_events (id, tenant_id, attempt_id, event_type, payload)
            VALUES
                (pg_catalog.uuidv7(), attempt_row.tenant_id, attempt_row.id, 'submission.attempt.submitted.v1',
                 jsonb_build_object('attempt_id', attempt_row.id, 'evaluation_request_count', request_count, 'reason', 'time_up')),
                (pg_catalog.uuidv7(), attempt_row.tenant_id, attempt_row.id, 'submission.attempt.grading.v1',
                 jsonb_build_object('attempt_id', attempt_row.id, 'evaluation_request_count', request_count));

            event_payload := jsonb_build_object(
                'tenant_id', attempt_row.tenant_id,
                'attempt_id', attempt_row.id,
                'candidate_assignment_id', attempt_row.candidate_assignment_id,
                'candidate_id', attempt_row.candidate_id,
                'exam_id', attempt_row.exam_id,
                'exam_version_id', attempt_row.exam_version_id,
                'evaluation_request_count', request_count,
                'submitted_at', attempt_row.submitted_at
            );
            INSERT INTO app.outbox_events (
                event_id, aggregate_type, aggregate_id, tenant_id, event_type,
                schema_version, payload, payload_sha256, occurred_at
            ) VALUES (
                pg_catalog.uuidv7(), 'attempt', attempt_row.id, attempt_row.tenant_id,
                'submission.attempt_submitted.v1', 1, event_payload,
                extensions.digest(convert_to(event_payload::text, 'UTF8'), 'sha256'), attempt_row.submitted_at
            );
        END IF;

        expired_count := expired_count + 1;
    END LOOP;

    RETURN expired_count;
END
$function$;

CREATE OR REPLACE FUNCTION submission.submit_attempt(
    p_submitted_event_id uuid,
    p_grading_event_id uuid,
    p_tenant_id uuid,
    p_attempt_id uuid,
    p_expected_attempt_version bigint,
    p_idempotency_key text,
    p_request_checksum text,
    p_evaluation_requests jsonb
)
RETURNS TABLE (
    id uuid,
    tenant_id uuid,
    exam_id uuid,
    exam_version_id uuid,
    candidate_id uuid,
    candidate_assignment_id uuid,
    attempt_number smallint,
    lifecycle_state text,
    available_from timestamptz,
    submission_deadline timestamptz,
    started_at timestamptz,
    submitted_at timestamptz,
    completed_at timestamptz,
    version bigint,
    created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz, submission
AS $function$
#variable_conflict use_column
DECLARE
    attempt_record submission.attempts%ROWTYPE;
    actor_id uuid;
    request_count integer;
    distinct_revision_count integer;
    distinct_request_count integer;
    expected_count integer;
BEGIN
    PERFORM submission.require_authorized_context(p_tenant_id, 'submission.write', 'submission.attempts');
    actor_id := authz.current_context_actor_id();
    IF p_submitted_event_id IS NULL OR p_grading_event_id IS NULL OR p_attempt_id IS NULL
       OR actor_id IS NULL OR p_expected_attempt_version <= 0
       OR length(btrim(p_idempotency_key)) NOT BETWEEN 1 AND 255
       OR p_request_checksum !~* '^[0-9a-f]{64}$'
       OR jsonb_typeof(p_evaluation_requests) <> 'array'
    THEN
        RAISE EXCEPTION 'attempt submission command is invalid';
    END IF;

    SELECT * INTO attempt_record
    FROM submission.attempts
    WHERE tenant_id = p_tenant_id AND id = p_attempt_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'candidate attempt was not found' USING ERRCODE = 'P0001';
    END IF;
    IF attempt_record.candidate_id <> actor_id THEN
        RAISE EXCEPTION 'attempt belongs to another candidate' USING ERRCODE = '42501';
    END IF;
    IF attempt_record.submit_idempotency_key IS NOT NULL THEN
        IF attempt_record.submit_idempotency_key <> p_idempotency_key
           OR attempt_record.submit_request_checksum <> p_request_checksum THEN
            RAISE EXCEPTION 'attempt idempotency key was reused with a different request' USING ERRCODE = '23505';
        END IF;
        RETURN QUERY
        SELECT attempt_record.id, attempt_record.tenant_id, attempt_record.exam_id, attempt_record.exam_version_id,
               attempt_record.candidate_id, attempt_record.candidate_assignment_id, attempt_record.attempt_number,
               attempt_record.lifecycle_state, attempt_record.available_from, attempt_record.submission_deadline,
               attempt_record.started_at, attempt_record.submitted_at, attempt_record.completed_at,
               attempt_record.version, attempt_record.created_at;
        RETURN;
    END IF;
    IF attempt_record.lifecycle_state <> 'active' OR clock_timestamp() >= attempt_record.submission_deadline + submission.answer_grace() THEN
        RAISE EXCEPTION 'attempt is no longer submittable' USING ERRCODE = '55000';
    END IF;
    IF attempt_record.version <> p_expected_attempt_version THEN
        RAISE EXCEPTION 'attempt version does not match' USING ERRCODE = '23505';
    END IF;
    IF jsonb_array_length(p_evaluation_requests) = 0 THEN
        RAISE EXCEPTION 'attempt submission command is invalid';
    END IF;

    WITH requested AS (
        SELECT *
        FROM jsonb_to_recordset(p_evaluation_requests) AS request_row(
            id uuid,
            answer_revision_id uuid,
            exam_item_id uuid,
            evaluation_bundle_object_key text,
            evaluation_bundle_checksum char(64),
            maximum_score numeric(12,4),
            caller_idempotency_key text
        )
    )
    SELECT count(*), count(DISTINCT answer_revision_id), count(DISTINCT id)
    INTO request_count, distinct_revision_count, distinct_request_count
    FROM requested;
    IF request_count <> distinct_revision_count OR request_count <> distinct_request_count THEN
        RAISE EXCEPTION 'evaluation request IDs and answer revisions must be unique';
    END IF;

    SELECT count(*) INTO expected_count
    FROM (
        SELECT DISTINCT ON (revision.exam_item_id) revision.id
        FROM submission.answer_revisions AS revision
        WHERE revision.tenant_id = p_tenant_id
          AND revision.attempt_id = p_attempt_id
        ORDER BY revision.exam_item_id, revision.revision_number DESC
    ) AS latest_revision;
    IF request_count <> expected_count OR expected_count = 0 THEN
        RAISE EXCEPTION 'evaluation requests do not cover the current answer set';
    END IF;

    IF EXISTS (
        WITH requested AS (
            SELECT *
            FROM jsonb_to_recordset(p_evaluation_requests) AS request_row(
                id uuid,
                answer_revision_id uuid,
                exam_item_id uuid,
                evaluation_bundle_object_key text,
                evaluation_bundle_checksum char(64),
                maximum_score numeric(12,4),
                caller_idempotency_key text
            )
        ), latest AS (
            SELECT DISTINCT ON (revision.exam_item_id)
                   revision.id AS answer_revision_id,
                   revision.exam_item_id,
                   item.evaluation_bundle_object_key,
                   item.evaluation_bundle_checksum,
                   item.maximum_score
            FROM submission.answer_revisions AS revision
            JOIN submission.assignment_item_projections AS item
              ON item.tenant_id = revision.tenant_id
             AND item.candidate_assignment_id = attempt_record.candidate_assignment_id
             AND item.exam_item_id = revision.exam_item_id
            WHERE revision.tenant_id = p_tenant_id
              AND revision.attempt_id = p_attempt_id
            ORDER BY revision.exam_item_id, revision.revision_number DESC
        )
        SELECT 1
        FROM requested
        FULL OUTER JOIN latest USING (answer_revision_id)
        WHERE requested.id IS NULL
           OR latest.answer_revision_id IS NULL
           OR requested.exam_item_id IS DISTINCT FROM latest.exam_item_id
           OR requested.evaluation_bundle_object_key IS DISTINCT FROM latest.evaluation_bundle_object_key
           OR requested.evaluation_bundle_checksum IS DISTINCT FROM latest.evaluation_bundle_checksum
           OR requested.maximum_score IS DISTINCT FROM latest.maximum_score
           OR length(btrim(requested.caller_idempotency_key)) NOT BETWEEN 1 AND 255
    ) THEN
        RAISE EXCEPTION 'evaluation requests are not an immutable snapshot of the current answers';
    END IF;

    INSERT INTO submission.evaluation_requests (
        id, tenant_id, attempt_id, answer_revision_id,
        evaluation_bundle_object_key, evaluation_bundle_checksum,
        caller_idempotency_key, maximum_score
    )
    SELECT
        request_row.id, p_tenant_id, p_attempt_id, request_row.answer_revision_id,
        request_row.evaluation_bundle_object_key, request_row.evaluation_bundle_checksum,
        request_row.caller_idempotency_key, request_row.maximum_score
    FROM jsonb_to_recordset(p_evaluation_requests) AS request_row(
        id uuid,
        answer_revision_id uuid,
        exam_item_id uuid,
        evaluation_bundle_object_key text,
        evaluation_bundle_checksum char(64),
        maximum_score numeric(12,4),
        caller_idempotency_key text
    );

    UPDATE submission.attempts
    SET lifecycle_state = 'grading',
        submitted_at = clock_timestamp(),
        submit_idempotency_key = p_idempotency_key,
        submit_request_checksum = p_request_checksum,
        version = version + 1
    WHERE tenant_id = p_tenant_id AND id = p_attempt_id
    RETURNING * INTO attempt_record;

    INSERT INTO submission.attempt_events (id, tenant_id, attempt_id, actor_id, event_type, payload)
    VALUES
        (
            p_submitted_event_id, p_tenant_id, p_attempt_id, actor_id, 'submission.attempt.submitted.v1',
            jsonb_build_object('attempt_id', p_attempt_id, 'evaluation_request_count', request_count)
        ),
        (
            p_grading_event_id, p_tenant_id, p_attempt_id, actor_id, 'submission.attempt.grading.v1',
            jsonb_build_object('attempt_id', p_attempt_id, 'evaluation_request_count', request_count)
        );

    RETURN QUERY
    SELECT attempt_record.id, attempt_record.tenant_id, attempt_record.exam_id, attempt_record.exam_version_id,
           attempt_record.candidate_id, attempt_record.candidate_assignment_id, attempt_record.attempt_number,
           attempt_record.lifecycle_state, attempt_record.available_from, attempt_record.submission_deadline,
           attempt_record.started_at, attempt_record.submitted_at, attempt_record.completed_at,
           attempt_record.version, attempt_record.created_at;
END
$function$;

CREATE OR REPLACE FUNCTION submission.prepare_submission(
    p_tenant_id uuid,
    p_attempt_id uuid,
    p_expected_attempt_version bigint
)
RETURNS TABLE (
    answer_revision_id uuid,
    exam_item_id uuid,
    evaluation_bundle_object_key text,
    evaluation_bundle_checksum char(64),
    maximum_score numeric(12,4)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz, submission
AS $function$
#variable_conflict use_column
DECLARE
    attempt_record submission.attempts%ROWTYPE;
    actor_id uuid;
BEGIN
    PERFORM submission.require_authorized_context(p_tenant_id, 'submission.write', 'submission.attempts');
    actor_id := authz.current_context_actor_id();
    SELECT * INTO attempt_record
    FROM submission.attempts
    WHERE tenant_id = p_tenant_id AND id = p_attempt_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'candidate attempt was not found' USING ERRCODE = 'P0001';
    END IF;
    IF actor_id IS NULL OR attempt_record.candidate_id <> actor_id THEN
        RAISE EXCEPTION 'attempt belongs to another candidate' USING ERRCODE = '42501';
    END IF;
    IF attempt_record.lifecycle_state <> 'active' OR clock_timestamp() >= attempt_record.submission_deadline + submission.answer_grace() THEN
        RAISE EXCEPTION 'attempt is no longer submittable' USING ERRCODE = '55000';
    END IF;
    IF p_expected_attempt_version <= 0 OR attempt_record.version <> p_expected_attempt_version THEN
        RAISE EXCEPTION 'attempt version does not match' USING ERRCODE = '23505';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM submission.answer_revisions AS revision
        WHERE revision.tenant_id = p_tenant_id AND revision.attempt_id = p_attempt_id
    ) THEN
        RAISE EXCEPTION 'attempt has no answer revisions';
    END IF;

    RETURN QUERY
    SELECT latest_revision.id,
           latest_revision.exam_item_id,
           item.evaluation_bundle_object_key,
           item.evaluation_bundle_checksum,
           item.maximum_score
    FROM (
        SELECT DISTINCT ON (revision.exam_item_id)
               revision.id, revision.exam_item_id, revision.revision_number
        FROM submission.answer_revisions AS revision
        WHERE revision.tenant_id = p_tenant_id
          AND revision.attempt_id = p_attempt_id
        ORDER BY revision.exam_item_id, revision.revision_number DESC
    ) AS latest_revision
    JOIN submission.assignment_item_projections AS item
      ON item.tenant_id = p_tenant_id
     AND item.candidate_assignment_id = attempt_record.candidate_assignment_id
     AND item.exam_item_id = latest_revision.exam_item_id;
END
$function$;

CREATE OR REPLACE FUNCTION submission.finalize_attempt_grading(
    p_tenant_id uuid,
    p_attempt_id uuid,
    p_attempt_event_id uuid,
    p_score_summary_id uuid,
    p_outbox_event_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, submission, extensions
AS $function$
DECLARE
    attempt_record submission.attempts%ROWTYPE;
    final_score numeric(12,4);
    final_maximum_score numeric(12,4);
    event_payload jsonb;
BEGIN
    SELECT * INTO attempt_record
    FROM submission.attempts
    WHERE tenant_id = p_tenant_id AND id = p_attempt_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'evaluation request has no attempt' USING ERRCODE = 'P0001';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM submission.evaluation_requests AS request_row
        WHERE request_row.tenant_id = p_tenant_id
          AND request_row.attempt_id = attempt_record.id
          AND request_row.lifecycle_state IN ('queued', 'dispatched')
    ) THEN
        RETURN false;
    END IF;

    -- An item earns its maximum score in proportion to the weight of the tests
    -- it passed. A receipt without a unit breakdown (a compile error reaches no
    -- test; a completion from before units were reported) is all or nothing, and
    -- a failed request has no receipt and earns nothing.
    SELECT
        COALESCE(sum(CASE
            WHEN unit_totals.total_weight IS NULL THEN
                CASE WHEN receipt.verdict = 'accepted' THEN request_row.maximum_score ELSE 0 END
            ELSE request_row.maximum_score * unit_totals.passed_weight / unit_totals.total_weight
        END), 0),
        COALESCE(sum(request_row.maximum_score), 0)
    INTO final_score, final_maximum_score
    FROM submission.evaluation_requests AS request_row
    LEFT JOIN submission.judge_receipts AS receipt
      ON receipt.tenant_id = request_row.tenant_id
     AND receipt.evaluation_request_id = request_row.id
    LEFT JOIN LATERAL (
        SELECT sum(unit.weight) AS total_weight,
               COALESCE(sum(unit.weight) FILTER (WHERE unit.verdict = 'accepted'), 0) AS passed_weight
        FROM submission.judge_receipt_units AS unit
        WHERE unit.tenant_id = receipt.tenant_id AND unit.judge_receipt_id = receipt.id
    ) AS unit_totals ON true
    WHERE request_row.tenant_id = p_tenant_id
      AND request_row.attempt_id = attempt_record.id;

    UPDATE submission.attempts
    SET lifecycle_state = 'graded',
        completed_at = COALESCE(completed_at, clock_timestamp()),
        version = version + 1
    WHERE tenant_id = p_tenant_id AND id = attempt_record.id
    RETURNING * INTO attempt_record;

    INSERT INTO submission.score_summaries (
        id, tenant_id, attempt_id, score, maximum_score,
        lifecycle_state, calculation_version, finalized_at
    ) VALUES (
        p_score_summary_id, p_tenant_id, attempt_record.id, final_score, final_maximum_score,
        'finalized', 2, clock_timestamp()
    )
    ON CONFLICT (tenant_id, attempt_id) DO UPDATE
    SET score = EXCLUDED.score,
        maximum_score = EXCLUDED.maximum_score,
        lifecycle_state = 'finalized',
        calculation_version = submission.score_summaries.calculation_version + 1,
        calculated_at = clock_timestamp(),
        finalized_at = clock_timestamp(),
        version = submission.score_summaries.version + 1;

    INSERT INTO submission.attempt_events (id, tenant_id, attempt_id, event_type, payload)
    VALUES (
        p_attempt_event_id, p_tenant_id, attempt_record.id, 'submission.attempt.graded.v1',
        jsonb_build_object(
            'attempt_id', attempt_record.id,
            'tenant_id', attempt_record.tenant_id,
            'candidate_assignment_id', attempt_record.candidate_assignment_id,
            'candidate_id', attempt_record.candidate_id,
            'exam_id', attempt_record.exam_id,
            'exam_version_id', attempt_record.exam_version_id,
            'attempt_number', attempt_record.attempt_number,
            'lifecycle_state', attempt_record.lifecycle_state,
            'score', final_score,
            'maximum_score', final_maximum_score
        )
    );

    event_payload := jsonb_build_object(
        'attempt_id', attempt_record.id,
        'tenant_id', attempt_record.tenant_id,
        'candidate_assignment_id', attempt_record.candidate_assignment_id,
        'candidate_id', attempt_record.candidate_id,
        'exam_id', attempt_record.exam_id,
        'exam_version_id', attempt_record.exam_version_id,
        'attempt_number', attempt_record.attempt_number,
        'lifecycle_state', attempt_record.lifecycle_state,
        'score', final_score,
        'maximum_score', final_maximum_score,
        'completed_at', attempt_record.completed_at
    );
    INSERT INTO app.outbox_events (
        event_id, aggregate_type, aggregate_id, tenant_id, event_type,
        schema_version, payload, payload_sha256, occurred_at
    ) VALUES (
        p_outbox_event_id, 'attempt', attempt_record.id, p_tenant_id, 'submission.attempt_graded.v1',
        1, event_payload,
        extensions.digest(convert_to(event_payload::text, 'UTF8'), 'sha256'), clock_timestamp()
    );

    RETURN true;
END
$function$;

DROP FUNCTION submission.evaluation_score(uuid, uuid);

ALTER TABLE submission.code_runs
    DROP CONSTRAINT custom_runs_carry_their_bundle,
    DROP COLUMN bundle_key_reference,
    DROP COLUMN bundle_checksum,
    DROP COLUMN bundle_object_key,
    DROP COLUMN kind;
ALTER TABLE submission.evaluation_requests DROP COLUMN origin;

RESET ROLE;
