-- The college's grading queue for staff (ADR-0043): graded evaluations and
-- sample runs waiting for Judge, the oldest wait, and how long verdicts took
-- in the last hour. Staff read it with score_summaries, like the monitor.
SET ROLE aether_submission_owner;

CREATE FUNCTION submission.get_grading_queue(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, authz, submission
AS $function$
DECLARE
    hour_ago timestamptz := clock_timestamp() - interval '1 hour';
BEGIN
    IF p_tenant_id IS NULL OR NOT authz.current_context_allows_read(
        p_tenant_id, 'submission.read', 'submission.write', 'submission.score_summaries'
    ) THEN
        RAISE EXCEPTION 'signed authorization context does not allow this submission operation'
            USING ERRCODE = '42501';
    END IF;
    RETURN jsonb_build_object(
        'checked_at', clock_timestamp(),
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

REVOKE ALL ON FUNCTION submission.get_grading_queue(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submission.get_grading_queue(uuid) TO aether_submission_app;

RESET ROLE;
