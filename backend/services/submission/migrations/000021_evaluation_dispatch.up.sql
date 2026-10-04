-- Submission now admits graded work to Judge. A dispatcher running as the
-- execute-only Judge adapter role claims queued evaluation requests, calls
-- Judge SubmitExecution, and records the returned job id; the adapter can reach
-- nothing but these routines.
--
-- A claim is a lease: it pushes dispatch_after into the future (doubling per
-- attempt, capped at five minutes) so a crashed or failing dispatcher's rows
-- become claimable again without any second routine, and two replicas never
-- claim the same row (FOR UPDATE SKIP LOCKED). Judge deduplicates on the
-- evaluation request id, so a replay after a crash between SubmitExecution and
-- mark_evaluation_dispatched returns the same job.
SET ROLE aether_submission_owner;

ALTER TABLE submission.evaluation_requests
    ADD COLUMN dispatch_attempts integer NOT NULL DEFAULT 0 CHECK (dispatch_attempts >= 0),
    ADD COLUMN dispatch_after timestamptz;

CREATE INDEX evaluation_requests_dispatch_idx
    ON submission.evaluation_requests (queued_at)
    WHERE lifecycle_state = 'queued';

CREATE FUNCTION submission.claim_evaluation_requests(
    p_limit integer,
    p_lease_seconds integer
)
RETURNS TABLE (
    evaluation_request_id uuid,
    tenant_id uuid,
    evaluation_bundle_object_key text,
    evaluation_bundle_checksum text,
    evaluation_bundle_key_reference text,
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
        RAISE EXCEPTION 'evaluation claim limits are invalid' USING ERRCODE = '22023';
    END IF;

    -- The item columns are LEFT JOINed on purpose: an item projected without a
    -- key reference or limits is still returned (with NULLs) so the dispatcher
    -- can fail it, instead of leaving it queued forever.
    -- expires_at is derived from queued_at so a replayed claim sends Judge the
    -- identical request, which its idempotency fingerprint requires.
    RETURN QUERY
    WITH due AS (
        SELECT request_row.id
        FROM submission.evaluation_requests AS request_row
        WHERE request_row.lifecycle_state = 'queued'
          AND (request_row.dispatch_after IS NULL OR request_row.dispatch_after <= clock_timestamp())
        ORDER BY request_row.queued_at
        LIMIT p_limit
        FOR UPDATE OF request_row SKIP LOCKED
    ), claimed AS (
        UPDATE submission.evaluation_requests AS request_row
        SET dispatch_attempts = request_row.dispatch_attempts + 1,
            dispatch_after = clock_timestamp() + make_interval(
                secs => least(p_lease_seconds * power(2, least(request_row.dispatch_attempts, 10)), 300)
            )
        FROM due
        WHERE request_row.id = due.id
        RETURNING request_row.id, request_row.tenant_id, request_row.attempt_id,
                  request_row.answer_revision_id, request_row.queued_at,
                  request_row.evaluation_bundle_object_key, request_row.evaluation_bundle_checksum
    )
    SELECT claimed.id, claimed.tenant_id, claimed.evaluation_bundle_object_key,
           claimed.evaluation_bundle_checksum::text, item.evaluation_bundle_key_reference,
           revision.source_object_key, revision.source_checksum::text, revision.encryption_key_reference,
           revision.language_id, item.time_limit_ms, item.memory_limit_kib,
           claimed.queued_at + interval '12 hours'
    FROM claimed
    JOIN submission.attempts AS attempt_row
      ON attempt_row.tenant_id = claimed.tenant_id AND attempt_row.id = claimed.attempt_id
    JOIN submission.answer_revisions AS revision
      ON revision.tenant_id = claimed.tenant_id AND revision.id = claimed.answer_revision_id
    LEFT JOIN submission.assignment_item_projections AS item
      ON item.tenant_id = claimed.tenant_id
     AND item.candidate_assignment_id = attempt_row.candidate_assignment_id
     AND item.exam_item_id = revision.exam_item_id
    ORDER BY claimed.queued_at;
END
$function$;

-- Records the job Judge accepted. A request cancelled while its submission was
-- in flight still gets the job id: Judge will complete the job regardless, and
-- the completion ingress refuses any completion whose job id is not recorded
-- locally, which would otherwise stall the whole completion bridge on it.
CREATE FUNCTION submission.mark_evaluation_dispatched(
    p_tenant_id uuid,
    p_evaluation_request_id uuid,
    p_judge_job_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, submission
AS $function$
BEGIN
    IF p_tenant_id IS NULL OR p_evaluation_request_id IS NULL OR p_judge_job_id IS NULL THEN
        RAISE EXCEPTION 'evaluation dispatch is invalid' USING ERRCODE = '22023';
    END IF;

    UPDATE submission.evaluation_requests AS request_row
    SET judge_job_id = p_judge_job_id,
        lifecycle_state = CASE WHEN request_row.lifecycle_state = 'queued' THEN 'dispatched' ELSE request_row.lifecycle_state END,
        dispatched_at = CASE WHEN request_row.lifecycle_state = 'queued' THEN clock_timestamp() ELSE request_row.dispatched_at END,
        version = request_row.version + 1
    WHERE request_row.tenant_id = p_tenant_id
      AND request_row.id = p_evaluation_request_id
      AND request_row.lifecycle_state IN ('queued', 'cancelled')
      AND request_row.judge_job_id IS NULL;
    RETURN FOUND;
END
$function$;

REVOKE ALL ON FUNCTION submission.claim_evaluation_requests(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION submission.mark_evaluation_dispatched(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submission.claim_evaluation_requests(integer, integer)
    TO aether_submission_judge_adapter;
GRANT EXECUTE ON FUNCTION submission.mark_evaluation_dispatched(uuid, uuid, uuid)
    TO aether_submission_judge_adapter;

RESET ROLE;
