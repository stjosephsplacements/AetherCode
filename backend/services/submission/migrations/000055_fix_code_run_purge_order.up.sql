-- 000054's purge_expired_code_runs ordered array_agg by purge_after, which the
-- batch subquery did not select, so every call failed with 42703 and Submission
-- would not start with retention enabled on a fresh database. Same body, with
-- purge_after selected. CREATE OR REPLACE keeps the existing grants.
SET ROLE aether_submission_owner;

CREATE OR REPLACE FUNCTION submission.purge_expired_code_runs(p_limit integer DEFAULT 500)
RETURNS TABLE (purged_runs bigint, purged_units bigint)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, submission
AS $function$
DECLARE
    batch_ids uuid[];
BEGIN
    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 5000 THEN
        RAISE EXCEPTION 'purge batch limit must be between 1 and 5000' USING ERRCODE = '22023';
    END IF;

    SELECT array_agg(id ORDER BY purge_after)
    INTO batch_ids
    FROM (
        SELECT id, purge_after
        FROM submission.code_runs
        WHERE purge_after <= clock_timestamp()
          AND lifecycle_state IN ('completed', 'failed', 'cancelled')
        ORDER BY purge_after
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    ) batch;

  IF batch_ids IS NULL OR cardinality(batch_ids) = 0 THEN
        purged_runs := 0;
        purged_units := 0;
        RETURN NEXT;
        RETURN;
    END IF;

    DELETE FROM submission.code_run_units
    WHERE code_run_id = ANY(batch_ids);

    GET DIAGNOSTICS purged_units = ROW_COUNT;

    DELETE FROM submission.code_runs
    WHERE id = ANY(batch_ids);

    GET DIAGNOSTICS purged_runs = ROW_COUNT;
    RETURN NEXT;
END
$function$;

RESET ROLE;
