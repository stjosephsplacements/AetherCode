-- One-click launch (sebs://). Safe Exam Browser downloads the launch file itself, with no
-- login cookie, so the candidate's session first mints a ticket: 256 random bits whose
-- SHA-256 is stored here with the tenant, exam and candidate it was issued to. The ticket
-- opens the launch-file URL once, within 60 seconds. The raw ticket is never stored.
SET ROLE aether_seb_owner;

CREATE TABLE seb.launch_tickets (
    token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
    tenant_id uuid NOT NULL,
    exam_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    title text NOT NULL,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz
);
CREATE INDEX launch_tickets_candidate_idx ON seb.launch_tickets (tenant_id, candidate_id, exam_id);

-- Reached only through the two functions below; the consume path has no tenant context, so
-- the table is not FORCEd and the app role gets no direct privileges.
ALTER TABLE seb.launch_tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE seb.launch_tickets FROM PUBLIC;

-- Candidate-self, under the signed context: the same open-assignment check as
-- candidate_exam_launch. A new ticket replaces the candidate's earlier ones for the exam,
-- and spent or expired rows are swept, so the table stays small.
CREATE FUNCTION seb.issue_launch_ticket(p_tenant_id uuid, p_exam_id uuid, p_token_hash bytea)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, seb, authz
AS $function$
DECLARE
    exam_title text;
    actor_id uuid;
BEGIN
    IF p_token_hash IS NULL OR octet_length(p_token_hash) <> 32 THEN
        RAISE EXCEPTION 'invalid SEB launch ticket' USING ERRCODE = '22023';
    END IF;
    exam_title := seb.candidate_exam_launch(p_tenant_id, p_exam_id);
    IF exam_title IS NULL THEN
        RETURN false;
    END IF;
    actor_id := authz.current_context_actor_id();
    DELETE FROM seb.launch_tickets
    WHERE expires_at < clock_timestamp() - interval '1 hour'
       OR (tenant_id = p_tenant_id AND candidate_id = actor_id AND exam_id = p_exam_id);
    INSERT INTO seb.launch_tickets (token_hash, tenant_id, exam_id, candidate_id, title, expires_at)
    VALUES (p_token_hash, p_tenant_id, p_exam_id, actor_id, exam_title, clock_timestamp() + interval '60 seconds');
    RETURN true;
END
$function$;

-- Anonymous: the ticket is the credential. One atomic UPDATE makes it single-use, and the
-- tenant and exam must match the ticket so it opens only the file it was issued for.
CREATE FUNCTION seb.consume_launch_ticket(p_tenant_id uuid, p_exam_id uuid, p_token_hash bytea)
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

REVOKE ALL ON FUNCTION seb.issue_launch_ticket(uuid, uuid, bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION seb.consume_launch_ticket(uuid, uuid, bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION seb.issue_launch_ticket(uuid, uuid, bytea) TO aether_seb_app;
GRANT EXECUTE ON FUNCTION seb.consume_launch_ticket(uuid, uuid, bytea) TO aether_seb_app;

RESET ROLE;
