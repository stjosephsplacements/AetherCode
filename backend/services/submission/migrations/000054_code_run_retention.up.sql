-- Purge ephemeral code-run rows after purge_after (ADR-0021 follow-up).
SET ROLE aether_submission_owner;

CREATE FUNCTION submission.purge_expired_code_runs(p_limit integer DEFAULT 500)
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
        SELECT id
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

CREATE FUNCTION submission.purge_code_runs_for_attempt(
    p_tenant_id uuid,
    p_attempt_id uuid,
    p_actor_id uuid,
    p_reason text
)
RETURNS TABLE (purged_runs bigint, purged_units bigint)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, submission, app, authz
AS $function$
BEGIN
    IF p_tenant_id IS NULL OR p_attempt_id IS NULL OR p_actor_id IS NULL
       OR p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
        RAISE EXCEPTION 'purge parameters are required' USING ERRCODE = '22023';
    END IF;
    IF NOT authz.current_context_allows(p_tenant_id, 'submission.write', 'submission.attempts') THEN
        RAISE EXCEPTION 'current authorization context cannot purge code runs'
            USING ERRCODE = '42501';
    END IF;

    INSERT INTO app.hard_delete_audit_log (table_name, record_id, deleted_by, deletion_reason, deleted_at)
    VALUES ('submission.code_runs', p_attempt_id, p_actor_id, left(p_reason, 500), clock_timestamp());

    DELETE FROM submission.code_run_units units
    USING submission.code_runs runs
    WHERE runs.tenant_id = p_tenant_id
      AND runs.attempt_id = p_attempt_id
      AND units.code_run_id = runs.id
      AND units.tenant_id = runs.tenant_id;

    GET DIAGNOSTICS purged_units = ROW_COUNT;

    DELETE FROM submission.code_runs
    WHERE tenant_id = p_tenant_id AND attempt_id = p_attempt_id;

    GET DIAGNOSTICS purged_runs = ROW_COUNT;
    RETURN NEXT;
END
$function$;

REVOKE ALL ON FUNCTION submission.purge_expired_code_runs(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION submission.purge_code_runs_for_attempt(uuid, uuid, uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION submission.purge_expired_code_runs(integer) TO aether_submission_app;
GRANT EXECUTE ON FUNCTION submission.purge_code_runs_for_attempt(uuid, uuid, uuid, text) TO aether_submission_app;

DO $grant$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aether_submission_retention_worker') THEN
        GRANT CONNECT ON DATABASE aether_submission TO aether_submission_retention_worker;
        GRANT USAGE ON SCHEMA submission, app TO aether_submission_retention_worker;
        GRANT EXECUTE ON FUNCTION submission.purge_expired_code_runs(integer)
            TO aether_submission_retention_worker;
    END IF;
END
$grant$;

RESET ROLE;