-- Staff visibility and control over permanently failed Judge dispatch work (ADR-0059 §2).
SET ROLE aether_submission_owner;

ALTER TABLE submission.evaluation_requests
    ADD COLUMN staff_dismissed_at timestamptz,
    ADD COLUMN staff_dismissal_reason text
        CHECK (staff_dismissal_reason IS NULL OR length(btrim(staff_dismissal_reason)) BETWEEN 1 AND 500);

ALTER TABLE submission.code_runs
    ADD COLUMN staff_dismissed_at timestamptz,
    ADD COLUMN staff_dismissal_reason text
        CHECK (staff_dismissal_reason IS NULL OR length(btrim(staff_dismissal_reason)) BETWEEN 1 AND 500);

CREATE FUNCTION submission.redact_grading_failure_summary(p_failure_code text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
    SELECT CASE
        WHEN btrim(COALESCE(p_failure_code, '')) = '' THEN 'unknown'
        ELSE left(split_part(btrim(p_failure_code), E'\n', 1), 200)
    END;
$function$;

CREATE FUNCTION submission._reopen_attempt_for_grading_retry(p_tenant_id uuid, p_attempt_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, submission
AS $function$
BEGIN
    UPDATE submission.attempts AS attempt_row
    SET lifecycle_state = 'grading',
        completed_at = NULL,
        version = attempt_row.version + 1
    WHERE attempt_row.tenant_id = p_tenant_id
      AND attempt_row.id = p_attempt_id
      AND attempt_row.lifecycle_state = 'graded'
      AND attempt_row.deleted_at IS NULL
      AND EXISTS (
          SELECT 1
          FROM submission.evaluation_requests AS request_row
          WHERE request_row.tenant_id = p_tenant_id
            AND request_row.attempt_id = p_attempt_id
            AND request_row.lifecycle_state IN ('queued', 'dispatched')
      );
END
$function$;

CREATE FUNCTION submission.retry_failed_evaluation_request(p_tenant_id uuid, p_request_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, submission
AS $function$
DECLARE
    attempt_id uuid;
    current_state text;
BEGIN
    SELECT request_row.lifecycle_state, request_row.attempt_id
      INTO current_state, attempt_id
    FROM submission.evaluation_requests AS request_row
    WHERE request_row.tenant_id = p_tenant_id AND request_row.id = p_request_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RETURN false;
    END IF;
    IF current_state = 'completed' THEN
        RETURN false;
    END IF;
    IF current_state <> 'failed' OR EXISTS (
        SELECT 1 FROM submission.evaluation_requests AS request_row
        WHERE request_row.tenant_id = p_tenant_id AND request_row.id = p_request_id
          AND request_row.staff_dismissed_at IS NOT NULL
    ) THEN
        RETURN false;
    END IF;

    UPDATE submission.evaluation_requests AS request_row
    SET lifecycle_state = 'queued',
        failure_code = NULL,
        judge_job_id = NULL,
        dispatched_at = NULL,
        completed_at = NULL,
        dispatch_attempts = 0,
        dispatch_after = NULL,
        version = request_row.version + 1
    WHERE request_row.tenant_id = p_tenant_id AND request_row.id = p_request_id;

    PERFORM submission._reopen_attempt_for_grading_retry(p_tenant_id, attempt_id);
    RETURN true;
END
$function$;

CREATE FUNCTION submission.retry_failed_code_run(p_tenant_id uuid, p_run_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, submission
AS $function$
DECLARE
    current_state text;
BEGIN
    SELECT run_row.lifecycle_state
      INTO current_state
    FROM submission.code_runs AS run_row
    WHERE run_row.tenant_id = p_tenant_id AND run_row.id = p_run_id
    FOR UPDATE;
    IF NOT FOUND OR current_state = 'completed' THEN
        RETURN false;
    END IF;
    IF current_state <> 'failed' OR EXISTS (
        SELECT 1 FROM submission.code_runs AS run_row
        WHERE run_row.tenant_id = p_tenant_id AND run_row.id = p_run_id
          AND run_row.staff_dismissed_at IS NOT NULL
    ) THEN
        RETURN false;
    END IF;

    UPDATE submission.code_runs AS run_row
    SET lifecycle_state = 'queued',
        failure_code = NULL,
        judge_job_id = NULL,
        dispatched_at = NULL,
        completed_at = NULL,
        verdict = NULL,
        dispatch_attempts = 0,
        dispatch_after = NULL
    WHERE run_row.tenant_id = p_tenant_id AND run_row.id = p_run_id;
    RETURN true;
END
$function$;

CREATE FUNCTION submission.retry_failed_grading_job(p_tenant_id uuid, p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz, submission
AS $function$
DECLARE
    retried boolean;
BEGIN
    PERFORM submission.require_authorized_context(p_tenant_id, 'submission.write', 'submission.score_summaries');
    IF p_tenant_id IS NULL OR p_job_id IS NULL THEN
        RAISE EXCEPTION 'retry command is invalid' USING ERRCODE = '22023';
    END IF;

    SELECT submission.retry_failed_evaluation_request(p_tenant_id, p_job_id) INTO retried;
    IF NOT retried THEN
        SELECT submission.retry_failed_code_run(p_tenant_id, p_job_id) INTO retried;
    END IF;
    RETURN jsonb_build_object('retried', COALESCE(retried, false));
END
$function$;

CREATE FUNCTION submission.retry_all_failed_grading_jobs(p_tenant_id uuid, p_limit integer DEFAULT 500)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz, submission
AS $function$
DECLARE
    job_id uuid;
    retried_count integer := 0;
    capped integer;
BEGIN
    PERFORM submission.require_authorized_context(p_tenant_id, 'submission.write', 'submission.score_summaries');
    IF p_tenant_id IS NULL THEN
        RAISE EXCEPTION 'retry command is invalid' USING ERRCODE = '22023';
    END IF;
    capped := least(greatest(COALESCE(p_limit, 500), 1), 500);

    FOR job_id IN
        SELECT request_row.id
        FROM submission.evaluation_requests AS request_row
        WHERE request_row.tenant_id = p_tenant_id
          AND request_row.lifecycle_state = 'failed'
          AND request_row.staff_dismissed_at IS NULL
        ORDER BY request_row.completed_at DESC NULLS LAST, request_row.id DESC
        LIMIT capped
    LOOP
        IF submission.retry_failed_evaluation_request(p_tenant_id, job_id) THEN
            retried_count := retried_count + 1;
        END IF;
    END LOOP;

    IF retried_count < capped THEN
        FOR job_id IN
            SELECT run_row.id
            FROM submission.code_runs AS run_row
            WHERE run_row.tenant_id = p_tenant_id
              AND run_row.lifecycle_state = 'failed'
              AND run_row.staff_dismissed_at IS NULL
            ORDER BY run_row.completed_at DESC NULLS LAST, run_row.id DESC
            LIMIT capped - retried_count
        LOOP
            IF submission.retry_failed_code_run(p_tenant_id, job_id) THEN
                retried_count := retried_count + 1;
            END IF;
            EXIT WHEN retried_count >= capped;
        END LOOP;
    END IF;

    RETURN jsonb_build_object('retried', retried_count);
END
$function$;

CREATE FUNCTION submission.dismiss_failed_grading_job(
    p_tenant_id uuid,
    p_job_id uuid,
    p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz, submission
AS $function$
DECLARE
    cleaned text := btrim(COALESCE(p_reason, ''));
    dismissed boolean := false;
BEGIN
    PERFORM submission.require_authorized_context(p_tenant_id, 'submission.write', 'submission.score_summaries');
    IF p_tenant_id IS NULL OR p_job_id IS NULL OR length(cleaned) NOT BETWEEN 1 AND 500 THEN
        RAISE EXCEPTION 'dismiss command is invalid' USING ERRCODE = '22023';
    END IF;

    UPDATE submission.evaluation_requests AS request_row
    SET lifecycle_state = 'cancelled',
        staff_dismissed_at = clock_timestamp(),
        staff_dismissal_reason = cleaned,
        completed_at = COALESCE(request_row.completed_at, clock_timestamp()),
        version = request_row.version + 1
    WHERE request_row.tenant_id = p_tenant_id
      AND request_row.id = p_job_id
      AND request_row.lifecycle_state = 'failed'
      AND request_row.staff_dismissed_at IS NULL
    RETURNING true INTO dismissed;

    IF NOT COALESCE(dismissed, false) THEN
        UPDATE submission.code_runs AS run_row
        SET lifecycle_state = 'cancelled',
            staff_dismissed_at = clock_timestamp(),
            staff_dismissal_reason = cleaned,
            completed_at = COALESCE(run_row.completed_at, clock_timestamp())
        WHERE run_row.tenant_id = p_tenant_id
          AND run_row.id = p_job_id
          AND run_row.lifecycle_state = 'failed'
          AND run_row.staff_dismissed_at IS NULL
        RETURNING true INTO dismissed;
    END IF;

    RETURN jsonb_build_object('dismissed', COALESCE(dismissed, false));
END
$function$;

CREATE FUNCTION submission.list_failed_grading_jobs(
    p_tenant_id uuid,
    p_limit integer DEFAULT 50,
    p_before timestamptz DEFAULT NULL,
    p_before_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, authz, submission
AS $function$
DECLARE
    capped integer;
    total_count bigint;
BEGIN
    IF p_tenant_id IS NULL OR NOT authz.current_context_allows_read(
        p_tenant_id, 'submission.read', 'submission.write', 'submission.score_summaries'
    ) THEN
        RAISE EXCEPTION 'signed authorization context does not allow this submission operation'
            USING ERRCODE = '42501';
    END IF;
    capped := least(greatest(COALESCE(p_limit, 50), 1), 200);
    IF (p_before IS NULL) <> (p_before_id IS NULL) THEN
        RAISE EXCEPTION 'failed job listing cursor must supply both parts' USING ERRCODE = '22023';
    END IF;

    SELECT (
        SELECT count(*) FROM submission.evaluation_requests AS request_row
        WHERE request_row.tenant_id = p_tenant_id
          AND request_row.lifecycle_state = 'failed'
          AND request_row.staff_dismissed_at IS NULL
    ) + (
        SELECT count(*) FROM submission.code_runs AS run_row
        WHERE run_row.tenant_id = p_tenant_id
          AND run_row.lifecycle_state = 'failed'
          AND run_row.staff_dismissed_at IS NULL
    ) INTO total_count;

    RETURN jsonb_build_object(
        'total', total_count,
        'items', COALESCE((
            SELECT jsonb_agg(page.row_item ORDER BY page.sort_at DESC NULLS LAST, page.sort_id DESC)
            FROM (
                SELECT combined.row_item, combined.sort_at, combined.sort_id
                FROM (
                    SELECT jsonb_build_object(
                        'id', request_row.id,
                        'kind', 'evaluation',
                        'submission_id', request_row.id,
                        'attempt_id', request_row.attempt_id,
                        'error_summary', submission.redact_grading_failure_summary(request_row.failure_code),
                        'dispatch_attempts', request_row.dispatch_attempts,
                        'failed_at', request_row.completed_at
                    ) AS row_item,
                           request_row.completed_at AS sort_at,
                           request_row.id AS sort_id
                    FROM submission.evaluation_requests AS request_row
                    WHERE request_row.tenant_id = p_tenant_id
                      AND request_row.lifecycle_state = 'failed'
                      AND request_row.staff_dismissed_at IS NULL
                    UNION ALL
                    SELECT jsonb_build_object(
                        'id', run_row.id,
                        'kind', 'run',
                        'submission_id', run_row.id,
                        'attempt_id', run_row.attempt_id,
                        'error_summary', submission.redact_grading_failure_summary(run_row.failure_code),
                        'dispatch_attempts', run_row.dispatch_attempts,
                        'failed_at', run_row.completed_at
                    ),
                           run_row.completed_at,
                           run_row.id
                    FROM submission.code_runs AS run_row
                    WHERE run_row.tenant_id = p_tenant_id
                      AND run_row.lifecycle_state = 'failed'
                      AND run_row.staff_dismissed_at IS NULL
                ) AS combined
                WHERE p_before IS NULL
                   OR (combined.sort_at, combined.sort_id) < (p_before, p_before_id)
                ORDER BY combined.sort_at DESC NULLS LAST, combined.sort_id DESC
                LIMIT capped
            ) AS page
        ), '[]'::jsonb)
    );
END
$function$;

CREATE OR REPLACE FUNCTION submission.get_grading_queue(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, authz, submission
AS $function$
DECLARE
    hour_ago timestamptz := clock_timestamp() - interval '1 hour';
    failed_open bigint;
BEGIN
    IF p_tenant_id IS NULL OR NOT authz.current_context_allows_read(
        p_tenant_id, 'submission.read', 'submission.write', 'submission.score_summaries'
    ) THEN
        RAISE EXCEPTION 'signed authorization context does not allow this submission operation'
            USING ERRCODE = '42501';
    END IF;

    SELECT (
        SELECT count(*) FROM submission.evaluation_requests AS request_row
        WHERE request_row.tenant_id = p_tenant_id
          AND request_row.lifecycle_state = 'failed'
          AND request_row.staff_dismissed_at IS NULL
    ) + (
        SELECT count(*) FROM submission.code_runs AS run_row
        WHERE run_row.tenant_id = p_tenant_id
          AND run_row.lifecycle_state = 'failed'
          AND run_row.staff_dismissed_at IS NULL
    ) INTO failed_open;

    RETURN jsonb_build_object(
        'checked_at', clock_timestamp(),
        'failed_open', failed_open,
        'evaluations', (
            SELECT jsonb_build_object(
                'queued', count(*) FILTER (WHERE lifecycle_state = 'queued'),
                'dispatched', count(*) FILTER (WHERE lifecycle_state = 'dispatched'),
                'oldest_waiting_at', min(queued_at) FILTER (WHERE lifecycle_state IN ('queued', 'dispatched')),
                'completed_last_hour', count(*) FILTER (WHERE lifecycle_state = 'completed' AND completed_at >= hour_ago),
                'failed_last_hour', count(*) FILTER (WHERE lifecycle_state = 'failed' AND completed_at >= hour_ago),
                'median_seconds_last_hour', percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM completed_at - queued_at))
                    FILTER (WHERE lifecycle_state = 'completed' AND completed_at >= hour_ago),
                'p95_seconds_last_hour', percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM completed_at - queued_at))
                    FILTER (WHERE lifecycle_state = 'completed' AND completed_at >= hour_ago)
            )
            FROM submission.evaluation_requests
            WHERE tenant_id = p_tenant_id AND (lifecycle_state IN ('queued', 'dispatched') OR completed_at >= hour_ago)
        ),
        'runs', (
            SELECT jsonb_build_object(
                'queued', count(*) FILTER (WHERE lifecycle_state = 'queued'),
                'dispatched', count(*) FILTER (WHERE lifecycle_state = 'dispatched'),
                'oldest_waiting_at', min(created_at) FILTER (WHERE lifecycle_state IN ('queued', 'dispatched')),
                'completed_last_hour', count(*) FILTER (WHERE lifecycle_state = 'completed' AND completed_at >= hour_ago),
                'failed_last_hour', count(*) FILTER (WHERE lifecycle_state = 'failed' AND completed_at >= hour_ago),
                'median_seconds_last_hour', percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM completed_at - created_at))
                    FILTER (WHERE lifecycle_state = 'completed' AND completed_at >= hour_ago),
                'p95_seconds_last_hour', percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM completed_at - created_at))
                    FILTER (WHERE lifecycle_state = 'completed' AND completed_at >= hour_ago)
            )
            FROM submission.code_runs
            WHERE tenant_id = p_tenant_id AND (lifecycle_state IN ('queued', 'dispatched') OR completed_at >= hour_ago)
        )
    );
END
$function$;

REVOKE ALL ON FUNCTION submission.redact_grading_failure_summary(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION submission._reopen_attempt_for_grading_retry(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION submission.retry_failed_evaluation_request(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION submission.retry_failed_code_run(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION submission.retry_failed_grading_job(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION submission.retry_all_failed_grading_jobs(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION submission.dismiss_failed_grading_job(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION submission.list_failed_grading_jobs(uuid, integer, timestamptz, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION submission.retry_failed_grading_job(uuid, uuid) TO aether_submission_app;
GRANT EXECUTE ON FUNCTION submission.retry_all_failed_grading_jobs(uuid, integer) TO aether_submission_app;
GRANT EXECUTE ON FUNCTION submission.dismiss_failed_grading_job(uuid, uuid, text) TO aether_submission_app;
GRANT EXECUTE ON FUNCTION submission.list_failed_grading_jobs(uuid, integer, timestamptz, uuid) TO aether_submission_app;

RESET ROLE;