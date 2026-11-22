SET ROLE aether_seb_owner;

DROP FUNCTION IF EXISTS seb.redeem_quit_token(char(64));
DROP FUNCTION IF EXISTS seb.issue_lockdown_quit_session(uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, char(64));
DROP FUNCTION IF EXISTS seb.ensure_lockdown_configuration(uuid, uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION seb.close_sessions_for_attempt(
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

ALTER TABLE seb.sessions
    DROP CONSTRAINT IF EXISTS sessions_quit_redeemed_check,
    DROP COLUMN IF EXISTS quit_redeemed_at;

RESET ROLE;