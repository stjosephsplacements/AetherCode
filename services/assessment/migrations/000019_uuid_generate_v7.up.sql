-- 000010 and 000011 call extensions.uuid_generate_v7() to mint assignment and
-- snapshot-event IDs, but no migration ever defined it. PL/pgSQL resolves
-- calls only when a function runs, so every batch, department and enrollment
-- materialization failed at runtime. Define it as PostgreSQL 18's built-in
-- RFC 9562 uuidv7(). The function lives in the owner-only extensions schema,
-- reachable from the security-definer callers and not from runtime roles.
SET ROLE aether_assessment_owner;

CREATE FUNCTION extensions.uuid_generate_v7()
RETURNS uuid
LANGUAGE sql
VOLATILE
PARALLEL SAFE
SET search_path = pg_catalog
AS $function$
    SELECT pg_catalog.uuidv7();
$function$;

REVOKE ALL ON FUNCTION extensions.uuid_generate_v7() FROM PUBLIC;

RESET ROLE;
