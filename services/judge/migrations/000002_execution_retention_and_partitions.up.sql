SET ROLE aether_judge_migrator;

CREATE OR REPLACE FUNCTION judge.create_execution_events_partition(partition_month date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, judge
AS $$
DECLARE
    month_start timestamptz;
    month_end timestamptz;
    partition_name text;
BEGIN
    IF partition_month <> date_trunc('month', partition_month)::date THEN
        RAISE EXCEPTION 'partition_month must be the first day of its month';
    END IF;

    month_start := partition_month::timestamp AT TIME ZONE 'UTC';
    month_end := (partition_month + INTERVAL '1 month')::timestamp AT TIME ZONE 'UTC';
    partition_name := format('execution_events_%s', to_char(partition_month, 'YYYYMM'));

    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS judge.%I PARTITION OF judge.execution_events FOR VALUES FROM (%L) TO (%L)',
        partition_name,
        month_start,
        month_end
    );
END;
$$;

REVOKE ALL ON FUNCTION judge.create_execution_events_partition(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION judge.create_execution_events_partition(date) TO aether_judge_migrator;

CREATE OR REPLACE FUNCTION judge.create_completion_deliveries_partition(partition_month date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, judge
AS $$
DECLARE
    month_start timestamptz;
    month_end timestamptz;
    partition_name text;
BEGIN
    IF partition_month <> date_trunc('month', partition_month)::date THEN
        RAISE EXCEPTION 'partition_month must be the first day of its month';
    END IF;

    month_start := partition_month::timestamp AT TIME ZONE 'UTC';
    month_end := (partition_month + INTERVAL '1 month')::timestamp AT TIME ZONE 'UTC';
    partition_name := format('completion_deliveries_%s', to_char(partition_month, 'YYYYMM'));

    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS judge.%I PARTITION OF judge.completion_deliveries FOR VALUES FROM (%L) TO (%L)',
        partition_name,
        month_start,
        month_end
    );
END;
$$;

REVOKE ALL ON FUNCTION judge.create_completion_deliveries_partition(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION judge.create_completion_deliveries_partition(date) TO aether_judge_migrator;

DO $$
DECLARE
    month_cursor date := date_trunc('month', CURRENT_DATE)::date;
    partition_offset integer;
BEGIN
    FOR partition_offset IN 0..2 LOOP
        PERFORM judge.create_execution_events_partition((month_cursor + make_interval(months => partition_offset))::date);
        PERFORM judge.create_completion_deliveries_partition((month_cursor + make_interval(months => partition_offset))::date);
    END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION judge.purge_expired_execution_data(retention_cutoff timestamptz)
RETURNS TABLE (
    deleted_execution_events bigint,
    deleted_outbox_events bigint,
    deleted_execution_jobs bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, judge
AS $$
DECLARE
    current_cutoff timestamptz := clock_timestamp() - INTERVAL '30 days';
    execution_event_count bigint;
    outbox_event_count bigint;
    execution_job_count bigint;
BEGIN
    IF retention_cutoff > current_cutoff THEN
        RAISE EXCEPTION 'retention cutoff % is newer than the 30-day wrapper retention boundary', retention_cutoff;
    END IF;

    DELETE FROM judge.execution_events
    WHERE occurred_at < retention_cutoff;
    GET DIAGNOSTICS execution_event_count = ROW_COUNT;

    -- Retention closes any terminal-result lease before deleting its partitioned
    -- delivery history. This prevents a 30-day-expired control record from
    -- being leased again while the purge is in progress.
    UPDATE judge.outbox_events
    SET state = 'expired', lease_owner = NULL, lease_id = NULL,
        lease_expires_at = NULL, updated_at = clock_timestamp()
    WHERE expires_at < retention_cutoff
      AND state IN ('pending', 'leased');

    DELETE FROM judge.completion_deliveries
    WHERE leased_at < retention_cutoff;

    DELETE FROM judge.outbox_events
    WHERE expires_at < retention_cutoff
      AND state IN ('acknowledged', 'expired');
    GET DIAGNOSTICS outbox_event_count = ROW_COUNT;

    DELETE FROM judge.execution_jobs
    WHERE terminal_at IS NOT NULL
      AND expires_at < retention_cutoff;
    GET DIAGNOSTICS execution_job_count = ROW_COUNT;

    RETURN QUERY SELECT execution_event_count, outbox_event_count, execution_job_count;
END;
$$;

REVOKE ALL ON FUNCTION judge.purge_expired_execution_data(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION judge.purge_expired_execution_data(timestamptz) TO aether_judge_migrator;
