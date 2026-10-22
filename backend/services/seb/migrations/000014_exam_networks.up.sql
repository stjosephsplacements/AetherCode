-- Lab networks (ADR-0030). An exam's policy may list the networks its
-- candidates must sit it from, independently of Safe Exam Browser keys. While
-- a candidate has an open assignment to such an exam, every request Gateway
-- checks must come from one of them; Gateway passes the client address it
-- trusts (its own peer, or X-Forwarded-For from a trusted proxy).
SET ROLE aether_seb_owner;

ALTER TABLE seb.exam_policies
    ADD COLUMN allowed_networks cidr[] NOT NULL DEFAULT '{}'
        CHECK (cardinality(allowed_networks) <= 50);

CREATE FUNCTION seb.check_exam_request(
    p_tenant_id uuid,
    p_url text,
    p_request_hash text,
    p_config_key_hash text,
    p_client_ip inet
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, seb, authz, app
AS $function$
DECLARE
    actor_id uuid;
    outside boolean;
BEGIN
    IF p_tenant_id IS NULL OR NOT authz.current_context_allows(p_tenant_id, 'seb.read', 'seb.sessions') THEN
        RAISE EXCEPTION 'current authorization context cannot check an SEB request' USING ERRCODE = '42501';
    END IF;
    actor_id := authz.current_context_actor_id();
    IF actor_id IS NULL THEN
        RAISE EXCEPTION 'current authorization context has no actor' USING ERRCODE = '42501';
    END IF;

    -- Any open exam with networks that do not include the client refuses it.
    -- An unknown client address is outside every network.
    SELECT bool_or(p_client_ip IS NULL OR NOT (p_client_ip <<= ANY (policy.allowed_networks)))
    INTO outside
    FROM seb.candidate_assignments AS assignment
    JOIN seb.exam_policies AS policy
      ON policy.tenant_id = assignment.tenant_id
     AND policy.exam_id = assignment.exam_id
     AND cardinality(policy.allowed_networks) > 0
    WHERE assignment.tenant_id = p_tenant_id
      AND assignment.candidate_id = actor_id
      AND assignment.lifecycle_state = 'active'
      AND (assignment.available_from IS NULL OR assignment.available_from <= clock_timestamp())
      AND (assignment.available_until IS NULL
           OR assignment.available_until + interval '5 minutes' > clock_timestamp());
    IF coalesce(outside, false) THEN
        RETURN 'network_refused';
    END IF;
    RETURN seb.check_exam_request(p_tenant_id, p_url, p_request_hash, p_config_key_hash);
END
$function$;

REVOKE ALL ON FUNCTION seb.check_exam_request(uuid, text, text, text, inet) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION seb.check_exam_request(uuid, text, text, text, inet) TO aether_seb_app;

RESET ROLE;
