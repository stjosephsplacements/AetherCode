-- Attempt expiry is wall-clock driven: no principal calls it, so there is no
-- identity assertion and no signed capability. The worker therefore runs as a
-- dedicated least-privilege role that can execute exactly one function and
-- reach no table directly, mirroring the notification retention worker.
SET ROLE aether_submission_owner;

CREATE FUNCTION submission.expire_overdue_attempts(p_limit integer DEFAULT 500)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, submission, app
AS $function$
DECLARE
    expired_count integer := 0;
    attempt_row   record;
    event_payload jsonb;
BEGIN
    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 5000 THEN
        RAISE EXCEPTION 'expiry batch limit must be between 1 and 5000' USING ERRCODE = '22023';
    END IF;

    FOR attempt_row IN
        SELECT id, tenant_id, exam_id, exam_version_id, candidate_id, version
        FROM submission.attempts
        WHERE lifecycle_state IN ('created', 'active')
          AND submission_deadline < CURRENT_TIMESTAMP
          AND deleted_at IS NULL
        ORDER BY submission_deadline
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    LOOP
        UPDATE submission.attempts
        SET lifecycle_state = 'expired',
            completed_at    = COALESCE(completed_at, CURRENT_TIMESTAMP),
            version         = version + 1
        WHERE id = attempt_row.id;

        -- The event is what lets SEB close the session and analytics record the
        -- outcome. Writing it in the same transaction as the state change is the
        -- whole point of the outbox.
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
        )
        VALUES (
            extensions.gen_random_uuid(),
            'attempt',
            attempt_row.id,
            attempt_row.tenant_id,
            'submission.attempt_expired.v1',
            1,
            event_payload,
            extensions.digest(convert_to(event_payload::text, 'UTF8'), 'sha256'),
            CURRENT_TIMESTAMP
        );

        expired_count := expired_count + 1;
    END LOOP;

    RETURN expired_count;
END
$function$;

CREATE INDEX attempts_expiry_scan_idx
    ON submission.attempts (submission_deadline)
    WHERE lifecycle_state IN ('created', 'active') AND deleted_at IS NULL;

REVOKE ALL ON FUNCTION submission.expire_overdue_attempts(integer) FROM PUBLIC;

-- The role is created by the platform provisioner in deploy/database/platform;
-- this block only grants it what it needs, and only if it exists, so the
-- migration stays runnable against a database where the role was not
-- provisioned (development, CI migration verification).
DO $grant$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aether_submission_expiry_worker') THEN
        GRANT USAGE ON SCHEMA submission, app TO aether_submission_expiry_worker;
        GRANT EXECUTE ON FUNCTION submission.expire_overdue_attempts(integer)
            TO aether_submission_expiry_worker;
    END IF;
END
$grant$;

RESET ROLE;
