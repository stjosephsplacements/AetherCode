-- Lifecycle projection: auto-close SEB sessions when attempts are submitted
-- or candidate assignments are revoked.
SET ROLE aether_seb_owner;

CREATE TABLE seb.projection_inbox_messages (
    consumer_name text NOT NULL CHECK (length(consumer_name) BETWEEN 1 AND 120),
    event_id uuid NOT NULL,
    payload_sha256 bytea NOT NULL CHECK (octet_length(payload_sha256) = 32),
    occurred_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    processed_at timestamptz,
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    last_error text,
    PRIMARY KEY (consumer_name, event_id)
);
CREATE INDEX seb_projection_inbox_pending_idx
    ON seb.projection_inbox_messages (received_at)
    WHERE processed_at IS NULL;

-- Close all active sessions for a specific attempt (when the attempt is submitted).
CREATE FUNCTION seb.close_sessions_for_attempt(
    p_event_id uuid,
    p_tenant_id uuid,
    p_attempt_id uuid,
    p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, seb
AS $function$
BEGIN
    IF p_event_id IS NULL OR p_tenant_id IS NULL OR p_attempt_id IS NULL
       OR p_reason IS NULL OR length(p_reason) = 0 THEN
        RAISE EXCEPTION 'invalid session close parameters' USING ERRCODE = '22023';
    END IF;

    -- Idempotent: no-op if no active session exists.
    UPDATE seb.sessions
    SET lifecycle_state = 'closed',
        closed_at = clock_timestamp(),
        closed_reason = p_reason,
        version = version + 1
    WHERE tenant_id = p_tenant_id
      AND attempt_id = p_attempt_id
      AND lifecycle_state = 'active';
END
$function$;

-- Close all active sessions for a specific candidate (when their assignment is revoked).
-- Since sessions table has no candidate_assignment_id, we close by candidate_id.
CREATE FUNCTION seb.close_sessions_for_candidate(
    p_event_id uuid,
    p_tenant_id uuid,
    p_candidate_id uuid,
    p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, seb
AS $function$
BEGIN
    IF p_event_id IS NULL OR p_tenant_id IS NULL OR p_candidate_id IS NULL
       OR p_reason IS NULL OR length(p_reason) = 0 THEN
        RAISE EXCEPTION 'invalid session close parameters' USING ERRCODE = '22023';
    END IF;

    -- Idempotent: no-op if no active session exists for this candidate.
    UPDATE seb.sessions
    SET lifecycle_state = 'closed',
        closed_at = clock_timestamp(),
        closed_reason = p_reason,
        version = version + 1
    WHERE tenant_id = p_tenant_id
      AND candidate_id = p_candidate_id
      AND lifecycle_state = 'active';
END
$function$;

GRANT SELECT, INSERT, UPDATE, DELETE ON seb.projection_inbox_messages
    TO aether_seb_projection_worker;

GRANT EXECUTE ON FUNCTION seb.close_sessions_for_attempt(uuid, uuid, uuid, text)
    TO aether_seb_projection_worker;
GRANT EXECUTE ON FUNCTION seb.close_sessions_for_candidate(uuid, uuid, uuid, text)
    TO aether_seb_projection_worker;

REVOKE ALL ON FUNCTION seb.close_sessions_for_attempt(uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION seb.close_sessions_for_candidate(uuid, uuid, uuid, text) FROM PUBLIC;

RESET ROLE;
