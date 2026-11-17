SET ROLE aether_submission_owner;

CREATE OR REPLACE FUNCTION submission.list_snapshots(p_tenant_id uuid, p_attempt_id uuid, p_limit integer DEFAULT 50)
RETURNS TABLE (id uuid, captured_at timestamptz, storage_key text, size_bytes integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, authz, submission AS $function$
BEGIN
    IF NOT authz.current_context_allows(p_tenant_id, 'submission.read', 'submission.snapshots') THEN
        RAISE EXCEPTION 'signed authorization context does not allow reading snapshots'
            USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
    SELECT snapshot.id, snapshot.captured_at, snapshot.storage_key, snapshot.size_bytes
    FROM submission.attempt_snapshots AS snapshot
    WHERE snapshot.tenant_id = p_tenant_id AND snapshot.attempt_id = p_attempt_id
    ORDER BY snapshot.captured_at DESC
    LIMIT LEAST(p_limit, 200);
END
$function$;

RESET ROLE;
