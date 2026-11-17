-- Two fixes found by the RBAC audit.
-- 1. analytics.batch_progress_department_rollups is read by an Analytics route and
--    guarded by RLS, but had no registered flags, so the route was refused for everyone.
--    The managed department and mentor roles get the flags for colleges that already exist.
-- 2. A mentor assigned to a batch must hold an active role in that batch's college.
SET ROLE aether_user_owner;

INSERT INTO users.permission_flags (key, bit_index, kind, elevated, platform_only) VALUES
    ('analytics.batch_progress_department_rollups.read', 205, 'resource', false, false),
    ('analytics.batch_progress_department_rollups.write', 206, 'resource', false, false),
    ('analytics.batch_progress_department_rollups.delete', 207, 'resource', false, false)
ON CONFLICT DO NOTHING;

UPDATE users.roles
SET permissions = permissions | users.flag_bits(ARRAY[
    'analytics.batch_progress_department_rollups.read',
    'analytics.batch_progress_department_rollups.write',
    'analytics.batch_progress_department_rollups.delete'])
WHERE managed AND system_key = 'department_user';

UPDATE users.roles
SET permissions = permissions | users.flag_bits(ARRAY['analytics.batch_progress_department_rollups.read'])
WHERE managed AND system_key = 'mentor';

CREATE FUNCTION users.principal_has_tenant_role(p_tenant_id uuid, p_principal_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, authz, users
AS $function$
BEGIN
    IF NOT authz.current_context_allows(p_tenant_id, 'user.write', 'users.mentor_batch_assignments') THEN
        RAISE EXCEPTION 'signed authorization context does not allow assigning mentors'
            USING ERRCODE = '42501';
    END IF;
    RETURN EXISTS (
        SELECT 1 FROM users.role_assignments AS assignment
        WHERE assignment.tenant_id = p_tenant_id
          AND assignment.principal_id = p_principal_id
          AND assignment.status = 'active'
          AND assignment.role_name <> 'student'
          AND (assignment.expires_at IS NULL OR assignment.expires_at > clock_timestamp())
    );
END
$function$;

REVOKE ALL ON FUNCTION users.principal_has_tenant_role(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION users.principal_has_tenant_role(uuid, uuid) TO aether_user_app;

RESET ROLE;
