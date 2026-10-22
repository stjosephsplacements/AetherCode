-- Audit log of staff actions (ADR-0043). Every protected write in the
-- platform is authorized here first, so the decision is the audit record:
-- who, which service and resource, in which college, allowed or denied.
-- Students' own writes (the self scope, such as autosave) are not recorded.
-- The read-only authorization role may only append through
-- record_staff_action; college administrators read through list_staff_audit.
SET ROLE aether_user_owner;

CREATE TABLE users.staff_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    principal_id uuid NOT NULL,
    tenant_id uuid,
    target_service text NOT NULL CHECK (length(target_service) BETWEEN 1 AND 64),
    resource_type text NOT NULL CHECK (length(resource_type) BETWEEN 1 AND 64),
    resource_id text NOT NULL CHECK (length(resource_id) BETWEEN 1 AND 200),
    allowed boolean NOT NULL
);
CREATE INDEX staff_audit_tenant_idx ON users.staff_audit (tenant_id, occurred_at DESC);
CREATE INDEX staff_audit_occurred_idx ON users.staff_audit (occurred_at);
ALTER TABLE users.staff_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE users.staff_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY staff_audit_owner ON users.staff_audit FOR ALL TO aether_user_owner USING (true) WITH CHECK (true);

-- Appends one decision; now and then drops records older than 400 days.
CREATE FUNCTION users.record_staff_action(
    p_principal_id uuid, p_tenant_id uuid, p_target_service text, p_resource_type text, p_resource_id text, p_allowed boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, users
AS $function$
BEGIN
    INSERT INTO users.staff_audit (principal_id, tenant_id, target_service, resource_type, resource_id, allowed)
    VALUES (p_principal_id, p_tenant_id, p_target_service, p_resource_type, left(p_resource_id, 200), p_allowed);
    IF random() < 0.001 THEN
        DELETE FROM users.staff_audit WHERE occurred_at < clock_timestamp() - interval '400 days';
    END IF;
END
$function$;

-- A college's audit log, newest first, before p_before, at most 200 rows.
CREATE FUNCTION users.list_staff_audit(p_tenant_id uuid, p_before timestamptz, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, users, authz, app
AS $function$
BEGIN
    IF NOT authz.current_context_allows(p_tenant_id, 'user.read', 'users.staff_audit') THEN
        RAISE EXCEPTION 'signed authorization context does not allow reading the audit log' USING ERRCODE = '42501';
    END IF;
    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN
        RAISE EXCEPTION 'limit must be between 1 and 200' USING ERRCODE = '22023';
    END IF;
    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                   'occurred_at', entry.occurred_at, 'principal_id', entry.principal_id,
                   'service', entry.target_service, 'resource_type', entry.resource_type,
                   'resource_id', entry.resource_id, 'allowed', entry.allowed
               ) ORDER BY entry.occurred_at DESC, entry.id DESC)
        FROM (SELECT * FROM users.staff_audit
              WHERE tenant_id = p_tenant_id AND (p_before IS NULL OR occurred_at < p_before)
              ORDER BY occurred_at DESC, id DESC LIMIT p_limit) AS entry
    ), '[]'::jsonb);
END
$function$;

-- The principals of this college among p_principal_ids, for showing names
-- (ADR-0043): the read-only twin of tenant_account_principals.
CREATE FUNCTION users.tenant_readable_principals(p_tenant_id uuid, p_principal_ids uuid[])
RETURNS SETOF uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, users, authz, app
AS $function$
BEGIN
    IF NOT (authz.current_context_allows(p_tenant_id, 'user.read', 'users.accounts')
            OR authz.current_context_allows(p_tenant_id, 'user.write', 'users.accounts')) THEN
        RAISE EXCEPTION 'current authorization context cannot read accounts' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY SELECT users.tenant_only_principals(p_tenant_id, p_principal_ids);
END
$function$;

REVOKE ALL ON FUNCTION users.tenant_readable_principals(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION users.tenant_readable_principals(uuid, uuid[]) TO aether_user_app;
REVOKE ALL ON FUNCTION users.record_staff_action(uuid, uuid, text, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION users.list_staff_audit(uuid, timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION users.record_staff_action(uuid, uuid, text, text, text, boolean) TO aether_user_authz_reader;
GRANT EXECUTE ON FUNCTION users.list_staff_audit(uuid, timestamptz, integer) TO aether_user_app;

RESET ROLE;
