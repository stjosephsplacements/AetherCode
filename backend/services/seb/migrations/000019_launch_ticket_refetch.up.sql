-- Safe Exam Browser downloads a sebs:// link a second time after the candidate types the exam
-- password (the first copy is encrypted and cannot be read without it). The ticket therefore opens
-- the launch file repeatedly, not once: the first download must come within the original 60 seconds,
-- and re-downloads are allowed for 120 seconds after that first download. Still bound to the tenant
-- and exam it was issued for, and replaced by the candidate's next ticket.
SET ROLE aether_seb_owner;

CREATE OR REPLACE FUNCTION seb.consume_launch_ticket(p_tenant_id uuid, p_exam_id uuid, p_token_hash bytea)
RETURNS text
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, seb
AS $function$
    UPDATE seb.launch_tickets
    SET consumed_at = COALESCE(consumed_at, clock_timestamp()),
        expires_at = CASE WHEN consumed_at IS NULL
                          THEN clock_timestamp() + interval '120 seconds' ELSE expires_at END
    WHERE token_hash = p_token_hash AND tenant_id = p_tenant_id AND exam_id = p_exam_id
      AND expires_at > clock_timestamp()
    RETURNING title
$function$;

RESET ROLE;
