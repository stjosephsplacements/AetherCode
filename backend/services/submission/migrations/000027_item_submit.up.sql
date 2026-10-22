-- Per-question submit, best score and custom-input runs (ADR-0025).
-- * A candidate submits one question: its latest saved code becomes a
--   permanent evaluation request (origin item_submit) on the item's full bundle.
-- * End test and time-up evaluate only latest revisions not already submitted,
--   and grade at once when nothing new is queued.
-- * Grading only runs for a handed-in attempt and scores each item's best
--   evaluation (calculation_version 3).
-- * A code run may carry a one-test sample bundle Submission built from the
--   candidate's own input (kind custom).
SET ROLE aether_submission_owner;

ALTER TABLE submission.evaluation_requests
    ADD COLUMN origin text NOT NULL DEFAULT 'final' CHECK (origin IN ('final', 'item_submit'));

ALTER TABLE submission.code_runs
    ADD COLUMN kind text NOT NULL DEFAULT 'sample' CHECK (kind IN ('sample', 'custom')),
    ADD COLUMN bundle_object_key text CHECK (bundle_object_key IS NULL OR length(bundle_object_key) > 0),
    ADD COLUMN bundle_checksum char(64) CHECK (bundle_checksum IS NULL OR bundle_checksum ~* '^[0-9a-f]{64}$'),
    ADD COLUMN bundle_key_reference text CHECK (bundle_key_reference IS NULL OR length(bundle_key_reference) > 0),
    ADD CONSTRAINT custom_runs_carry_their_bundle CHECK (
        (kind = 'custom') = (bundle_object_key IS NOT NULL)
        AND (bundle_object_key IS NULL) = (bundle_checksum IS NULL)
        AND (bundle_object_key IS NULL) = (bundle_key_reference IS NULL)
    );

CREATE FUNCTION submission.evaluation_score(p_tenant_id uuid, p_evaluation_request_id uuid)
RETURNS numeric(12,4)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, submission
AS $function$
    -- The item's maximum score times the weight of passed tests over the weight
    -- of all tests. A receipt without a unit breakdown (a compile error reaches
    -- no test) is all or nothing; a request without a receipt earns nothing.
    SELECT COALESCE(
        CASE
            WHEN unit_totals.total_weight IS NULL THEN
                CASE WHEN receipt.verdict = 'accepted' THEN request_row.maximum_score ELSE 0 END
            ELSE request_row.maximum_score * unit_totals.passed_weight / unit_totals.total_weight
        END, 0)::numeric(12,4)
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
      AND request_row.id = p_evaluation_request_id
$function$;

REVOKE ALL ON FUNCTION submission.evaluation_score(uuid, uuid) FROM PUBLIC;

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
    -- A per-question submit completes while the candidate is still working;
    -- only an attempt that was handed in (or timed out) is graded.
    IF attempt_record.lifecycle_state <> 'grading' THEN
        RETURN false;
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

    -- Each item scores its best evaluation: a per-question submit or the
    -- final hand-in (ADR-0025). An evaluation earns the item's maximum score in
    -- proportion to the weight of the tests it passed (evaluation_score).
    SELECT COALESCE(sum(best.score), 0), COALESCE(sum(best.maximum_score), 0)
    INTO final_score, final_maximum_score
    FROM (
        SELECT max(submission.evaluation_score(p_tenant_id, request_row.id)) AS score,
               max(request_row.maximum_score) AS maximum_score
        FROM submission.evaluation_requests AS request_row
        JOIN submission.answer_revisions AS revision
          ON revision.tenant_id = request_row.tenant_id
         AND revision.id = request_row.answer_revision_id
        WHERE request_row.tenant_id = p_tenant_id
          AND request_row.attempt_id = attempt_record.id
        GROUP BY revision.exam_item_id
    ) AS best;

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
        'finalized', 3, clock_timestamp()
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
               revision.id, revision.tenant_id, revision.exam_item_id, revision.revision_number
        FROM submission.answer_revisions AS revision
        WHERE revision.tenant_id = p_tenant_id
          AND revision.attempt_id = p_attempt_id
        ORDER BY revision.exam_item_id, revision.revision_number DESC
    ) AS latest_revision
    JOIN submission.assignment_item_projections AS item
      ON item.tenant_id = p_tenant_id
     AND item.candidate_assignment_id = attempt_record.candidate_assignment_id
     AND item.exam_item_id = latest_revision.exam_item_id
    -- Code already submitted per question needs no second evaluation (ADR-0025).
    WHERE NOT EXISTS (
        SELECT 1 FROM submission.evaluation_requests AS evaluated
        WHERE evaluated.tenant_id = p_tenant_id
          AND evaluated.answer_revision_id = latest_revision.id
    );
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
    IF NOT EXISTS (
        SELECT 1 FROM submission.answer_revisions AS revision
        WHERE revision.tenant_id = p_tenant_id AND revision.attempt_id = p_attempt_id
    ) THEN
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

    -- Latest revisions not already evaluated by a per-question submit.
    SELECT count(*) INTO expected_count
    FROM (
        SELECT DISTINCT ON (revision.exam_item_id) revision.id, revision.tenant_id
        FROM submission.answer_revisions AS revision
        WHERE revision.tenant_id = p_tenant_id
          AND revision.attempt_id = p_attempt_id
        ORDER BY revision.exam_item_id, revision.revision_number DESC
    ) AS latest_revision
    WHERE NOT EXISTS (
        SELECT 1 FROM submission.evaluation_requests AS evaluated
        WHERE evaluated.tenant_id = latest_revision.tenant_id
          AND evaluated.answer_revision_id = latest_revision.id
    );
    IF request_count <> expected_count THEN
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
        ), pending AS (
            SELECT latest.* FROM latest
            WHERE NOT EXISTS (
                SELECT 1 FROM submission.evaluation_requests AS evaluated
                WHERE evaluated.tenant_id = p_tenant_id
                  AND evaluated.answer_revision_id = latest.answer_revision_id
            )
        )
        SELECT 1
        FROM requested
        FULL OUTER JOIN pending AS latest USING (answer_revision_id)
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

    -- When every answer was already submitted and judged, nothing new is
    -- queued and no completion will arrive to grade the attempt: grade it now.
    IF submission.finalize_attempt_grading(p_tenant_id, p_attempt_id, pg_catalog.uuidv7(), pg_catalog.uuidv7(), pg_catalog.uuidv7()) THEN
        SELECT * INTO attempt_record FROM submission.attempts WHERE tenant_id = p_tenant_id AND id = p_attempt_id;
    END IF;

    RETURN QUERY
    SELECT attempt_record.id, attempt_record.tenant_id, attempt_record.exam_id, attempt_record.exam_version_id,
           attempt_record.candidate_id, attempt_record.candidate_assignment_id, attempt_record.attempt_number,
           attempt_record.lifecycle_state, attempt_record.available_from, attempt_record.submission_deadline,
           attempt_record.started_at, attempt_record.submitted_at, attempt_record.completed_at,
           attempt_record.version, attempt_record.created_at;
END
$function$;

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
        WITH newest AS (
            SELECT DISTINCT ON (revision.exam_item_id) revision.id, revision.exam_item_id
            FROM submission.answer_revisions AS revision
            WHERE revision.tenant_id = attempt_row.tenant_id
              AND revision.attempt_id = attempt_row.id
            ORDER BY revision.exam_item_id, revision.revision_number DESC
        ), latest AS (
            -- Code already submitted per question needs no second evaluation.
            SELECT newest.* FROM newest
            WHERE NOT EXISTS (
                SELECT 1 FROM submission.evaluation_requests AS evaluated
                WHERE evaluated.tenant_id = attempt_row.tenant_id
                  AND evaluated.answer_revision_id = newest.id
            )
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

        IF request_count = 0 AND NOT EXISTS (
            SELECT 1 FROM submission.answer_revisions AS revision
            WHERE revision.tenant_id = attempt_row.tenant_id AND revision.attempt_id = attempt_row.id
        ) THEN
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
            -- Every answer was already submitted per question: grade now.
            PERFORM submission.finalize_attempt_grading(
                attempt_row.tenant_id, attempt_row.id, pg_catalog.uuidv7(), pg_catalog.uuidv7(), pg_catalog.uuidv7()
            );
        END IF;

        expired_count := expired_count + 1;
    END LOOP;

    RETURN expired_count;
END
$function$;

CREATE FUNCTION submission.submit_item(
    p_request_id uuid,
    p_outbox_event_id uuid,
    p_tenant_id uuid,
    p_attempt_id uuid,
    p_exam_item_id uuid
)
RETURNS TABLE (
    id uuid,
    answer_revision_id uuid,
    lifecycle_state text,
    queued_at timestamptz,
    created boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz, submission, extensions
AS $function$
#variable_conflict use_column
DECLARE
    attempt_record submission.attempts%ROWTYPE;
    item_record submission.assignment_item_projections%ROWTYPE;
    revision_record submission.answer_revisions%ROWTYPE;
    existing submission.evaluation_requests%ROWTYPE;
    actor_id uuid;
    payload jsonb;
BEGIN
    PERFORM submission.require_authorized_context(p_tenant_id, 'submission.write', 'submission.attempts');
    actor_id := authz.current_context_actor_id();
    IF p_request_id IS NULL OR p_outbox_event_id IS NULL OR p_attempt_id IS NULL OR p_exam_item_id IS NULL THEN
        RAISE EXCEPTION 'item submission command is invalid';
    END IF;
    SELECT * INTO attempt_record
    FROM submission.attempts
    WHERE tenant_id = p_tenant_id AND id = p_attempt_id AND deleted_at IS NULL
    FOR UPDATE;
    IF NOT FOUND OR actor_id IS NULL OR attempt_record.candidate_id <> actor_id THEN
        RAISE EXCEPTION 'candidate attempt was not found' USING ERRCODE = 'P0001';
    END IF;
    IF attempt_record.lifecycle_state <> 'active'
       OR clock_timestamp() >= attempt_record.submission_deadline + submission.answer_grace() THEN
        RAISE EXCEPTION 'attempt is no longer submittable' USING ERRCODE = '55000', DETAIL = 'candidate: The exam has ended.';
    END IF;
    SELECT * INTO item_record
    FROM submission.assignment_item_projections
    WHERE tenant_id = p_tenant_id
      AND candidate_assignment_id = attempt_record.candidate_assignment_id
      AND exam_item_id = p_exam_item_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'exam item was not found' USING ERRCODE = 'P0001';
    END IF;
    SELECT * INTO revision_record
    FROM submission.answer_revisions
    WHERE tenant_id = p_tenant_id AND attempt_id = p_attempt_id AND exam_item_id = p_exam_item_id
    ORDER BY revision_number DESC
    LIMIT 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'item has no saved answer' USING ERRCODE = '55000', DETAIL = 'candidate: Write and save some code before submitting.';
    END IF;

    -- The same code submitted twice is one evaluation.
    SELECT * INTO existing
    FROM submission.evaluation_requests
    WHERE tenant_id = p_tenant_id AND answer_revision_id = revision_record.id;
    IF FOUND THEN
        RETURN QUERY SELECT existing.id, existing.answer_revision_id, existing.lifecycle_state, existing.queued_at, false;
        RETURN;
    END IF;
    IF (
        SELECT count(*) FROM submission.evaluation_requests AS open_request
        WHERE open_request.tenant_id = p_tenant_id
          AND open_request.attempt_id = p_attempt_id
          AND open_request.lifecycle_state IN ('queued', 'dispatched')
    ) >= 2 THEN
        RAISE EXCEPTION 'too many submissions in flight' USING ERRCODE = '55000',
            DETAIL = 'candidate: Your last submissions are still being judged. Try again in a moment.';
    END IF;

    INSERT INTO submission.evaluation_requests (
        id, tenant_id, attempt_id, answer_revision_id,
        evaluation_bundle_object_key, evaluation_bundle_checksum,
        caller_idempotency_key, maximum_score, origin
    ) VALUES (
        p_request_id, p_tenant_id, p_attempt_id, revision_record.id,
        item_record.evaluation_bundle_object_key, item_record.evaluation_bundle_checksum,
        'item-submit:' || revision_record.id::text, item_record.maximum_score, 'item_submit'
    );

    payload := jsonb_build_object(
        'evaluation_request_id', p_request_id,
        'attempt_id', p_attempt_id,
        'answer_revision_id', revision_record.id,
        'exam_item_id', p_exam_item_id,
        'evaluation_bundle_object_key', item_record.evaluation_bundle_object_key,
        'evaluation_bundle_checksum', item_record.evaluation_bundle_checksum,
        'maximum_score', item_record.maximum_score,
        'caller_idempotency_key', 'item-submit:' || revision_record.id::text
    );
    INSERT INTO app.outbox_events (
        event_id, aggregate_type, aggregate_id, tenant_id, event_type,
        schema_version, payload, payload_sha256, occurred_at
    ) VALUES (
        p_outbox_event_id, 'evaluation_request', p_request_id, p_tenant_id,
        'submission.evaluation_requested.v1', 1, payload,
        extensions.digest(convert_to(payload::text, 'UTF8'), 'sha256'), clock_timestamp()
    );

    RETURN QUERY
    SELECT request_row.id, request_row.answer_revision_id, request_row.lifecycle_state, request_row.queued_at, true
    FROM submission.evaluation_requests AS request_row
    WHERE request_row.tenant_id = p_tenant_id AND request_row.id = p_request_id;
END
$function$;

REVOKE ALL ON FUNCTION submission.submit_item(uuid, uuid, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submission.submit_item(uuid, uuid, uuid, uuid, uuid) TO aether_submission_app;

-- The candidate's evaluations of one item, newest first. Hidden tests are
-- reported as counts per verdict only: which test failed, and how long it
-- ran, would describe a hidden test to a candidate still being graded on it.
CREATE FUNCTION submission.list_item_submissions_for_candidate(
    p_tenant_id uuid,
    p_attempt_id uuid,
    p_exam_item_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, submission, authz
AS $function$
DECLARE
    signed_actor_id uuid;
    response jsonb;
BEGIN
    IF NOT authz.current_context_allows_read(
        p_tenant_id, 'submission.read', 'submission.write', 'submission.attempts'
    ) THEN
        RAISE EXCEPTION 'signed authorization context does not allow this submission operation'
            USING ERRCODE = '42501';
    END IF;
    signed_actor_id := authz.current_context_actor_id();
    IF signed_actor_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM submission.attempts AS attempt
        WHERE attempt.tenant_id = p_tenant_id AND attempt.id = p_attempt_id
          AND attempt.candidate_id = signed_actor_id AND attempt.deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'candidate attempt was not found' USING ERRCODE = 'P0001';
    END IF;

    SELECT COALESCE(jsonb_agg(row_to_json(entry)::jsonb ORDER BY entry.queued_at DESC, entry.id DESC), '[]'::jsonb)
    INTO response
    FROM (
        SELECT request_row.id,
               request_row.origin,
               request_row.lifecycle_state,
               revision.language_id,
               revision.revision_number,
               request_row.queued_at,
               request_row.completed_at,
               receipt.verdict,
               CASE WHEN receipt.id IS NULL AND request_row.lifecycle_state <> 'failed' THEN NULL
                    ELSE submission.evaluation_score(p_tenant_id, request_row.id)::text END AS score,
               request_row.maximum_score::text AS maximum_score,
               units.passed_units,
               units.total_units,
               COALESCE(units.verdict_counts, '{}'::jsonb) AS verdict_counts
        FROM submission.evaluation_requests AS request_row
        JOIN submission.answer_revisions AS revision
          ON revision.tenant_id = request_row.tenant_id
         AND revision.id = request_row.answer_revision_id
        LEFT JOIN LATERAL (
            SELECT * FROM submission.judge_receipts AS candidate_receipt
            WHERE candidate_receipt.tenant_id = request_row.tenant_id
              AND candidate_receipt.evaluation_request_id = request_row.id
            ORDER BY candidate_receipt.received_at DESC
            LIMIT 1
        ) AS receipt ON true
        LEFT JOIN LATERAL (
            SELECT count(*) FILTER (WHERE unit.verdict = 'accepted')::integer AS passed_units,
                   count(*)::integer AS total_units,
                   (SELECT jsonb_object_agg(counted.verdict, counted.total)
                    FROM (SELECT inner_unit.verdict, count(*) AS total
                          FROM submission.judge_receipt_units AS inner_unit
                          WHERE inner_unit.tenant_id = receipt.tenant_id AND inner_unit.judge_receipt_id = receipt.id
                          GROUP BY inner_unit.verdict) AS counted) AS verdict_counts
            FROM submission.judge_receipt_units AS unit
            WHERE unit.tenant_id = receipt.tenant_id AND unit.judge_receipt_id = receipt.id
        ) AS units ON receipt.id IS NOT NULL
        WHERE request_row.tenant_id = p_tenant_id
          AND request_row.attempt_id = p_attempt_id
          AND revision.exam_item_id = p_exam_item_id
        ORDER BY request_row.queued_at DESC, request_row.id DESC
        LIMIT 50
    ) AS entry;
    RETURN response;
END
$function$;

REVOKE ALL ON FUNCTION submission.list_item_submissions_for_candidate(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submission.list_item_submissions_for_candidate(uuid, uuid, uuid) TO aether_submission_app;

-- A run against the candidate's own input (kind custom).
CREATE FUNCTION submission.start_custom_run(
    p_run_id uuid,
    p_tenant_id uuid,
    p_attempt_id uuid,
    p_exam_item_id uuid,
    p_language_id text,
    p_source_object_key text,
    p_source_checksum text,
    p_encryption_key_reference text,
    p_bundle_object_key text,
    p_bundle_checksum text,
    p_bundle_key_reference text
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
       OR p_bundle_object_key IS NULL OR length(p_bundle_object_key) = 0
       OR p_bundle_checksum !~* '^[0-9a-f]{64}$'
       OR p_bundle_key_reference IS NULL OR length(p_bundle_key_reference) = 0
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
    IF item_record.time_limit_ms IS NULL THEN
        RAISE EXCEPTION 'exam item has no execution limits' USING ERRCODE = '55000',
            DETAIL = 'candidate: This question cannot run custom input.';
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
        source_object_key, source_checksum, encryption_key_reference, purge_after,
        kind, bundle_object_key, bundle_checksum, bundle_key_reference
    ) VALUES (
        p_run_id, p_tenant_id, p_attempt_id, p_exam_item_id, actor_id, p_language_id,
        p_source_object_key, lower(p_source_checksum), p_encryption_key_reference,
        clock_timestamp() + interval '30 days',
        'custom', p_bundle_object_key, lower(p_bundle_checksum), p_bundle_key_reference
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

REVOKE ALL ON FUNCTION submission.start_custom_run(uuid, uuid, uuid, uuid, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submission.start_custom_run(uuid, uuid, uuid, uuid, text, text, text, text, text, text, text) TO aether_submission_app;

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
    -- A custom-input run carries its own one-test sample bundle.
    SELECT claimed.id, claimed.tenant_id,
           COALESCE(claimed.bundle_object_key, item.sample_bundle_object_key, ''),
           COALESCE(claimed.bundle_checksum::text, item.sample_bundle_checksum::text, ''),
           COALESCE(claimed.bundle_key_reference, item.sample_bundle_key_reference),
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

RESET ROLE;
