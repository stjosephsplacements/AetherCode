SET ROLE aether_user_owner;

-- ADR-0020: college staff author into the global question bank. A tenant grant
-- now says whether it comes from a college_admin or department_user role, as
-- "authoring": true. The key is omitted otherwise, so every other grant and
-- every consumer that ignores it is unchanged. The question bank's projection
-- turns it into global read/write.
CREATE OR REPLACE FUNCTION users.effective_authz_grants(p_principal_id uuid)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, users
AS $function$
    WITH active_roles AS (
        SELECT assignment.role_name, assignment.scope_kind, assignment.tenant_id,
               assignment.scope_id, assignment.expires_at
        FROM users.role_assignments AS assignment
        WHERE assignment.principal_id = p_principal_id
          AND assignment.status = 'active'
          AND (assignment.expires_at IS NULL OR assignment.expires_at > clock_timestamp())
    ), raw_grants AS (
        SELECT 'platform'::text AS grant_kind,
               '00000000-0000-0000-0000-000000000000'::uuid AS tenant_id,
               '00000000-0000-0000-0000-000000000000'::uuid AS grant_source_id,
               role.expires_at,
               false AS authoring
        FROM active_roles AS role
        WHERE role.scope_kind = 'platform'
        UNION ALL
        SELECT 'tenant'::text, role.tenant_id, role.tenant_id, role.expires_at,
               role.role_name IN ('college_admin', 'department_user')
        FROM active_roles AS role
        WHERE role.scope_kind IN ('college', 'department', 'batch', 'self')
          AND role.tenant_id IS NOT NULL
        UNION ALL
        SELECT 'placement'::text, student.tenant_id, role.scope_id,
               CASE
                   WHEN role.expires_at IS NULL THEN staff.expires_at
                   WHEN staff.expires_at IS NULL THEN role.expires_at
                   ELSE LEAST(role.expires_at, staff.expires_at)
               END,
               false
        FROM active_roles AS role
        JOIN users.placement_department_memberships AS staff
          ON staff.principal_id = p_principal_id
         AND staff.placement_department_id = role.scope_id
         AND staff.status = 'active'
         AND (staff.expires_at IS NULL OR staff.expires_at > clock_timestamp())
        JOIN users.student_department_memberships AS membership
          ON membership.department_id = role.scope_id
         AND membership.department_type = 'placement'
         AND membership.status = 'active'
        JOIN users.students AS student ON student.id = membership.student_id
        WHERE role.scope_kind = 'placement_department'
          AND student.status = 'active'
    ), grouped_grants AS (
        SELECT grant_kind, tenant_id, grant_source_id,
               CASE WHEN bool_or(expires_at IS NULL) THEN NULL ELSE max(expires_at) END AS expires_at,
               bool_or(authoring) AS authoring
        FROM raw_grants
        GROUP BY grant_kind, tenant_id, grant_source_id
    )
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'grant_kind', grant_kind,
                'tenant_id', tenant_id,
                'grant_source_id', grant_source_id,
                'expires_at', CASE WHEN expires_at IS NULL THEN '' ELSE to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END
            ) || CASE WHEN authoring THEN jsonb_build_object('authoring', true) ELSE '{}'::jsonb END
            ORDER BY grant_kind, tenant_id, grant_source_id
        ),
        '[]'::jsonb
    )
    FROM grouped_grants
$function$;

-- Republish the snapshot of every current staff member once, so projections
-- learn the new flag without waiting for an unrelated role change.
SELECT users.bump_authz_revision(staff.principal_id, 'staff_authoring_grant')
FROM (
    SELECT DISTINCT assignment.principal_id
    FROM users.role_assignments AS assignment
    WHERE assignment.status = 'active'
      AND assignment.role_name IN ('college_admin', 'department_user')
) AS staff;

RESET ROLE;
