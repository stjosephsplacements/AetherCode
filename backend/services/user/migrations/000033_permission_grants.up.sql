-- Per-person permissions (ADR-0055).
--
-- A grant adds one permission, "<service>.<resource>.<verb>", to what a person's
-- role already allows. It never removes anything. Write and delete imply read; the
-- application stores the implied read as its own row, and the authorizer expands
-- it again, so a hand-edited row cannot leave write without read.
SET ROLE aether_user_owner;

CREATE TABLE users.permission_grants (
    id uuid PRIMARY KEY,
    principal_id uuid NOT NULL,
    scope_kind text NOT NULL CHECK (scope_kind IN ('platform', 'college')),
    tenant_id uuid,
    permission text NOT NULL CHECK (permission ~ '^[a-z][a-z-]{1,30}\.[a-z][a-z_]{1,63}\.(read|write|delete)$'),
    granted_by_principal_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK ((scope_kind = 'platform' AND tenant_id IS NULL) OR (scope_kind = 'college' AND tenant_id IS NOT NULL))
);
CREATE UNIQUE INDEX permission_grants_unique
    ON users.permission_grants (principal_id, scope_kind, COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), permission);
CREATE INDEX permission_grants_principal_idx ON users.permission_grants (principal_id);

CREATE FUNCTION users.on_permission_grant_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, users AS $function$
BEGIN
    PERFORM users.bump_authz_revision(CASE WHEN TG_OP = 'DELETE' THEN OLD.principal_id ELSE NEW.principal_id END, 'permission_grant');
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$function$;
REVOKE ALL ON FUNCTION users.on_permission_grant_change() FROM PUBLIC;

CREATE TRIGGER permission_grants_bump_authz AFTER INSERT OR UPDATE OR DELETE ON users.permission_grants
FOR EACH ROW EXECUTE FUNCTION users.on_permission_grant_change();

ALTER TABLE users.permission_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE users.permission_grants FORCE ROW LEVEL SECURITY;

CREATE POLICY permission_grants_owner_maintenance ON users.permission_grants FOR ALL TO aether_user_owner USING (true) WITH CHECK (true);
CREATE POLICY permission_grants_authz_reader ON users.permission_grants FOR SELECT TO aether_user_authz_reader USING (true);

CREATE POLICY permission_grants_app_read ON users.permission_grants FOR SELECT TO aether_user_app
    USING (
        (tenant_id IS NOT NULL AND (
            authz.current_context_allows(tenant_id, 'user.read', 'users.permission_grants')
            OR authz.current_context_allows(tenant_id, 'user.write', 'users.permission_grants')
        ))
        OR (tenant_id IS NULL AND (
            authz.current_global_context_allows('user.read', 'users.permission_grants')
            OR authz.current_global_context_allows('user.write', 'users.permission_grants')
        ))
    );
CREATE POLICY permission_grants_app_insert ON users.permission_grants FOR INSERT TO aether_user_app
    WITH CHECK (
        (tenant_id IS NOT NULL AND authz.current_context_allows(tenant_id, 'user.write', 'users.permission_grants'))
        OR (tenant_id IS NULL AND authz.current_global_context_allows('user.write', 'users.permission_grants'))
    );
CREATE POLICY permission_grants_app_delete ON users.permission_grants FOR DELETE TO aether_user_app
    USING (
        (tenant_id IS NOT NULL AND authz.current_context_allows(tenant_id, 'user.write', 'users.permission_grants'))
        OR (tenant_id IS NULL AND authz.current_global_context_allows('user.write', 'users.permission_grants'))
    );

GRANT SELECT, INSERT, DELETE ON users.permission_grants TO aether_user_app;
GRANT SELECT ON users.permission_grants TO aether_user_authz_reader;

RESET ROLE;
