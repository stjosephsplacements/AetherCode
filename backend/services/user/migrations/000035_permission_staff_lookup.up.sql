SET ROLE aether_user_owner;

-- Permission editors need only a yes/no staff check, not unrestricted role rows.
CREATE FUNCTION users.permission_target_is_staff(p_principal_id uuid, p_tenant_id uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, authz, users AS $function$
    SELECT CASE WHEN p_tenant_id IS NULL
        THEN authz.current_global_context_allows('user.write', 'users.permission_grants')
        ELSE authz.current_context_allows(p_tenant_id, 'user.write', 'users.permission_grants')
    END AND EXISTS (
        SELECT 1 FROM users.active_role_assignments
        WHERE principal_id = p_principal_id AND role_name <> 'student'
          AND (scope_kind = 'platform' OR tenant_id = p_tenant_id OR (p_tenant_id IS NULL AND tenant_id IS NOT NULL))
    );
$function$;
REVOKE ALL ON FUNCTION users.permission_target_is_staff(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION users.permission_target_is_staff(uuid, uuid) TO aether_user_app;

RESET ROLE;
