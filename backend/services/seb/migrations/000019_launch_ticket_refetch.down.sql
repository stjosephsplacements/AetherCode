SET ROLE aether_seb_owner;

CREATE OR REPLACE FUNCTION seb.consume_launch_ticket(p_tenant_id uuid, p_exam_id uuid, p_token_hash bytea)
RETURNS text
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, seb
AS $function$
    UPDATE seb.launch_tickets
    SET consumed_at = clock_timestamp()
    WHERE token_hash = p_token_hash AND tenant_id = p_tenant_id AND exam_id = p_exam_id
      AND consumed_at IS NULL AND expires_at > clock_timestamp()
    RETURNING title
$function$;

RESET ROLE;
