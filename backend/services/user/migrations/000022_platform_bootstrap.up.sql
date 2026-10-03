-- The first super_admin has no granter: role_assignments.granted_by_principal_id
-- is NOT NULL, and no principal exists yet who could have granted it. This
-- assignment therefore self-grants, and it is the only one in the system
-- permitted to. The function refuses once any super_admin exists.
SET ROLE aether_user_owner;

CREATE FUNCTION users.bootstrap_first_superadmin(
    p_assignment_id uuid,
    p_principal_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, users
AS $function$
DECLARE
    existing_id uuid;
BEGIN
    SELECT id INTO existing_id
    FROM users.role_assignments
    WHERE principal_id = p_principal_id
      AND role_name = 'super_admin'
      AND scope_kind = 'platform'
      AND status = 'active'
      AND deleted_at IS NULL;
    IF existing_id IS NOT NULL THEN
        RETURN existing_id;
    END IF;

    IF EXISTS (
        SELECT 1 FROM users.role_assignments
        WHERE role_name = 'super_admin' AND status = 'active' AND deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'platform already has a super_admin; bootstrap is closed'
            USING ERRCODE = '42501';
    END IF;

    INSERT INTO users.role_assignments (
        id, principal_id, role_name, scope_kind, tenant_id, scope_id,
        status, granted_by_principal_id
    )
    VALUES (
        p_assignment_id, p_principal_id, 'super_admin', 'platform', NULL, NULL,
        'active', p_principal_id
    );

    RETURN p_assignment_id;
END
$function$;

REVOKE ALL ON FUNCTION users.bootstrap_first_superadmin(uuid, uuid) FROM PUBLIC;

RESET ROLE;
