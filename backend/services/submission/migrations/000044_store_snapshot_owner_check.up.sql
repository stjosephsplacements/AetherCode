-- store_snapshot only checked the tenant-level write context, so a candidate could
-- add frames to another candidate's attempt. It now requires the caller's own attempt.
SET ROLE aether_submission_owner;

CREATE OR REPLACE FUNCTION submission.store_snapshot(
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
    -- A candidate may only add frames to their own open attempt.
    IF NOT EXISTS (
        SELECT 1 FROM submission.attempts AS attempt
        WHERE attempt.tenant_id = p_tenant_id AND attempt.id = p_attempt_id
          AND attempt.candidate_id = authz.current_context_actor_id()
          AND attempt.deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'candidate attempt was not found' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO submission.attempt_snapshots (tenant_id, attempt_id, captured_at, storage_key, size_bytes)
    VALUES (p_tenant_id, p_attempt_id, p_captured_at, p_storage_key, p_size_bytes)
    ON CONFLICT (tenant_id, attempt_id, captured_at) DO NOTHING
    RETURNING id INTO v_id;
    RETURN v_id;
END
$function$;

RESET ROLE;
