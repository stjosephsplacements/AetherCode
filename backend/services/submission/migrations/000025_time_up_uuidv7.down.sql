SET ROLE aether_submission_owner;

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
            SELECT extensions.gen_random_uuid(), attempt_row.tenant_id, attempt_row.id, latest.id,
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
        SELECT extensions.gen_random_uuid(), 'evaluation_request', announced.id, attempt_row.tenant_id,
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
                extensions.gen_random_uuid(), 'attempt', attempt_row.id, attempt_row.tenant_id,
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
                (extensions.gen_random_uuid(), attempt_row.tenant_id, attempt_row.id, 'submission.attempt.submitted.v1',
                 jsonb_build_object('attempt_id', attempt_row.id, 'evaluation_request_count', request_count, 'reason', 'time_up')),
                (extensions.gen_random_uuid(), attempt_row.tenant_id, attempt_row.id, 'submission.attempt.grading.v1',
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
                extensions.gen_random_uuid(), 'attempt', attempt_row.id, attempt_row.tenant_id,
                'submission.attempt_submitted.v1', 1, event_payload,
                extensions.digest(convert_to(event_payload::text, 'UTF8'), 'sha256'), attempt_row.submitted_at
            );
        END IF;

        expired_count := expired_count + 1;
    END LOOP;

    RETURN expired_count;
END
$function$;

RESET ROLE;
