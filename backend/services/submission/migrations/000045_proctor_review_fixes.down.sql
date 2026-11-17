SET ROLE aether_submission_owner;

GRANT SELECT, INSERT ON TABLE submission.attempt_snapshots TO aether_submission_app;

CREATE OR REPLACE FUNCTION submission.store_snapshot(
    p_tenant_id uuid, p_attempt_id uuid,
    p_captured_at timestamptz, p_storage_key text, p_size_bytes integer
)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, authz, submission AS $function$
DECLARE
    v_id uuid;
BEGIN
    IF NOT authz.current_context_allows(p_tenant_id, 'submission.write', 'submission.attempts') THEN
        RAISE EXCEPTION 'signed authorization context does not allow storing snapshots'
            USING ERRCODE = '42501';
    END IF;
    IF p_attempt_id IS NULL OR p_captured_at IS NULL OR
       p_storage_key IS NULL OR p_size_bytes IS NULL OR p_size_bytes <= 0 THEN
        RAISE EXCEPTION 'snapshot fields are invalid';
    END IF;
    -- A candidate may only add frames to their own open attempt.
    IF NOT EXISTS (
        SELECT 1 FROM submission.attempts AS attempt
        WHERE attempt.tenant_id = p_tenant_id AND attempt.id = p_attempt_id
          AND attempt.candidate_id = authz.current_context_actor_id()
          AND attempt.deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'candidate attempt was not found' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO submission.attempt_snapshots (tenant_id, attempt_id, captured_at, storage_key, size_bytes)
    VALUES (p_tenant_id, p_attempt_id, p_captured_at, p_storage_key, p_size_bytes)
    ON CONFLICT (tenant_id, attempt_id, captured_at) DO NOTHING
    RETURNING id INTO v_id;
    RETURN v_id;
END
$function$;

DROP FUNCTION submission.submit_attempt_for_violation(uuid, uuid, text);

CREATE FUNCTION submission.submit_attempt_for_violation(p_attempt_id uuid, p_reason text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, submission, app
AS $function$
DECLARE
    attempt_row   submission.attempts%ROWTYPE;
    request_count integer;
    event_payload jsonb;
BEGIN
    IF p_attempt_id IS NULL OR p_reason IS NULL OR pg_catalog.length(p_reason) NOT BETWEEN 1 AND 100 THEN
        RAISE EXCEPTION 'attempt id and a reason of 1 to 100 characters are required' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO attempt_row
    FROM submission.attempts
    WHERE id = p_attempt_id
      AND lifecycle_state IN ('created', 'active')
      AND deleted_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
        RETURN false;
    END IF;

    WITH newest AS (
        SELECT DISTINCT ON (revision.exam_item_id) revision.id, revision.exam_item_id
        FROM submission.answer_revisions AS revision
        WHERE revision.tenant_id = attempt_row.tenant_id
          AND revision.attempt_id = attempt_row.id
        ORDER BY revision.exam_item_id, revision.revision_number DESC
    ), latest AS (
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
               'violation:' || latest.id::text, item.maximum_score
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
    ) AND NOT EXISTS (
        SELECT 1 FROM submission.choice_answers AS choice
        WHERE choice.tenant_id = attempt_row.tenant_id AND choice.attempt_id = attempt_row.id
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
            'expired_at',      CURRENT_TIMESTAMP,
            'reason',          p_reason
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
             jsonb_build_object('attempt_id', attempt_row.id, 'evaluation_request_count', request_count, 'reason', p_reason)),
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
        PERFORM submission.finalize_attempt_grading(
            attempt_row.tenant_id, attempt_row.id, pg_catalog.uuidv7(), pg_catalog.uuidv7(), pg_catalog.uuidv7()
        );
    END IF;

    RETURN true;
END
$function$;

REVOKE ALL ON FUNCTION submission.submit_attempt_for_violation(uuid, text) FROM PUBLIC;
DO $grant$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aether_submission_expiry_worker') THEN
        GRANT EXECUTE ON FUNCTION submission.submit_attempt_for_violation(uuid, text)
            TO aether_submission_expiry_worker;
    END IF;
END
$grant$;

RESET ROLE;
