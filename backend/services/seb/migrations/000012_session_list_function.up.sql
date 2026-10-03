-- Candidate-facing SEB session collection, bound to the signed actor exactly as
-- the self-session validation path in 000006 is.
SET ROLE aether_seb_owner;

CREATE INDEX sessions_candidate_keyset_idx
    ON seb.sessions (tenant_id, candidate_id, issued_at DESC, id DESC);

CREATE FUNCTION seb.list_sessions(
    p_tenant_id uuid,
    p_limit integer,
    p_cursor_issued_at timestamptz,
    p_cursor_id uuid,
    p_lifecycle_state text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, seb, authz
AS $function$
DECLARE
    signed_actor_id uuid;
    response jsonb;
BEGIN
    signed_actor_id := authz.current_context_actor_id();
    IF signed_actor_id IS NULL THEN
        RAISE EXCEPTION 'current authorization context has no actor' USING ERRCODE = '42501';
    END IF;
    -- 101 accommodates the caller's limit+1 probe for next-page detection.
    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 101 THEN
        RAISE EXCEPTION 'session listing limit must be between 1 and 100' USING ERRCODE = '22023';
    END IF;
    IF (p_cursor_issued_at IS NULL) <> (p_cursor_id IS NULL) THEN
        RAISE EXCEPTION 'session listing cursor must supply both parts' USING ERRCODE = '22023';
    END IF;

    -- quit_token_hash is deliberately excluded: it is a credential, not
    -- listable session metadata.
    SELECT COALESCE(jsonb_agg(row_to_json(item)::jsonb ORDER BY item.issued_at DESC, item.id DESC), '[]'::jsonb)
    INTO response
    FROM (
        SELECT session_row.id,
               session_row.tenant_id,
               session_row.configuration_id,
               session_row.attempt_id,
               session_row.candidate_id,
               session_row.lifecycle_state,
               session_row.issued_at,
               session_row.activated_at,
               session_row.closed_at,
               session_row.expires_at,
               session_row.closed_reason,
               session_row.version
        FROM seb.sessions AS session_row
        WHERE session_row.tenant_id = p_tenant_id
          AND session_row.candidate_id = signed_actor_id
          AND session_row.deleted_at IS NULL
          AND (p_lifecycle_state IS NULL OR session_row.lifecycle_state = p_lifecycle_state)
          AND (
                p_cursor_issued_at IS NULL
                OR (session_row.issued_at, session_row.id) < (p_cursor_issued_at, p_cursor_id)
              )
        ORDER BY session_row.issued_at DESC, session_row.id DESC
        LIMIT p_limit
    ) AS item;

    RETURN response;
END
$function$;

REVOKE ALL ON FUNCTION seb.list_sessions(uuid, integer, timestamptz, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION seb.list_sessions(uuid, integer, timestamptz, uuid, text) TO aether_seb_app;

RESET ROLE;
