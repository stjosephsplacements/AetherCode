-- Keyset paging for webcam snapshots: optional before_id continues past the
-- 200-row page that staff and evidence export previously truncated at.
SET ROLE aether_submission_owner;

DROP FUNCTION IF EXISTS submission.list_snapshots(uuid, uuid, integer);

CREATE FUNCTION submission.list_snapshots(
    p_tenant_id uuid,
    p_attempt_id uuid,
    p_limit integer DEFAULT 50,
    p_before_id uuid DEFAULT NULL
)
RETURNS TABLE (id uuid, captured_at timestamptz, storage_key text, size_bytes integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, authz, submission AS $function$
DECLARE
    v_before_at timestamptz;
    v_before_id uuid;
BEGIN
    IF NOT (authz.current_context_allows(p_tenant_id, 'submission.read', 'submission.snapshots')
         OR authz.current_context_allows(p_tenant_id, 'submission.read', 'submission.proctor_evidence')) THEN
        RAISE EXCEPTION 'signed authorization context does not allow reading snapshots'
            USING ERRCODE = '42501';
    END IF;
    IF p_before_id IS NOT NULL THEN
        SELECT snapshot.captured_at, snapshot.id
        INTO v_before_at, v_before_id
        FROM submission.attempt_snapshots AS snapshot
        WHERE snapshot.tenant_id = p_tenant_id
          AND snapshot.attempt_id = p_attempt_id
          AND snapshot.id = p_before_id;
        IF v_before_id IS NULL THEN
            RAISE EXCEPTION 'snapshot cursor was not found on this attempt'
                USING ERRCODE = 'P0002';
        END IF;
    END IF;
    RETURN QUERY
    SELECT snapshot.id, snapshot.captured_at, snapshot.storage_key, snapshot.size_bytes
    FROM submission.attempt_snapshots AS snapshot
    WHERE snapshot.tenant_id = p_tenant_id
      AND snapshot.attempt_id = p_attempt_id
      AND (
          p_before_id IS NULL
          OR (snapshot.captured_at, snapshot.id) < (v_before_at, v_before_id)
      )
    ORDER BY snapshot.captured_at DESC, snapshot.id DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
END
$function$;

REVOKE ALL ON FUNCTION submission.list_snapshots(uuid, uuid, integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submission.list_snapshots(uuid, uuid, integer, uuid) TO aether_submission_app;

RESET ROLE;
