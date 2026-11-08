SET ROLE aether_submission_owner;

-- Proctoring phase 2: webcam snapshots stored in MinIO and indexed here.
-- Access is gated by VIEW_STUDENT_PII (submission.read on snapshots resource).

CREATE TABLE submission.attempt_snapshots (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    attempt_id uuid NOT NULL,
    captured_at timestamptz NOT NULL,
    storage_key text NOT NULL,
    size_bytes integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 524288),
    content_type text NOT NULL DEFAULT 'image/jpeg',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (id),
    UNIQUE (tenant_id, attempt_id, captured_at)
);

CREATE INDEX attempt_snapshots_attempt_idx
    ON submission.attempt_snapshots (tenant_id, attempt_id, captured_at DESC);

CREATE FUNCTION submission.store_snapshot(
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
    INSERT INTO submission.attempt_snapshots (tenant_id, attempt_id, captured_at, storage_key, size_bytes)
    VALUES (p_tenant_id, p_attempt_id, p_captured_at, p_storage_key, p_size_bytes)
    ON CONFLICT (tenant_id, attempt_id, captured_at) DO NOTHING
    RETURNING id INTO v_id;
    RETURN v_id;
END
$function$;

CREATE FUNCTION submission.list_snapshots(p_tenant_id uuid, p_attempt_id uuid, p_limit integer DEFAULT 50)
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

REVOKE ALL ON TABLE submission.attempt_snapshots FROM PUBLIC;
GRANT SELECT, INSERT ON TABLE submission.attempt_snapshots TO aether_submission_app;
REVOKE ALL ON FUNCTION submission.store_snapshot(uuid,uuid,timestamptz,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submission.store_snapshot(uuid,uuid,timestamptz,text,integer) TO aether_submission_app;
REVOKE ALL ON FUNCTION submission.list_snapshots(uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submission.list_snapshots(uuid,uuid,integer) TO aether_submission_app;

RESET ROLE;
