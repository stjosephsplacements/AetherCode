SET ROLE aether_user_owner;

-- Revert RLS on projection tables.
DROP POLICY IF EXISTS tenant_batch_projections_app_read ON users.tenant_batch_projections;
DROP POLICY IF EXISTS tenant_batch_projections_projection_worker ON users.tenant_batch_projections;
DROP POLICY IF EXISTS tenant_batch_projections_owner_maintenance ON users.tenant_batch_projections;
ALTER TABLE users.tenant_batch_projections DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_department_projections_app_read ON users.tenant_department_projections;
DROP POLICY IF EXISTS tenant_department_projections_projection_worker ON users.tenant_department_projections;
DROP POLICY IF EXISTS tenant_department_projections_owner_maintenance ON users.tenant_department_projections;
ALTER TABLE users.tenant_department_projections DISABLE ROW LEVEL SECURITY;

-- Revert current_context_valid_student to the pre-node-scoped version.
CREATE OR REPLACE FUNCTION users.current_context_valid_student(
    p_tenant_id uuid,
    p_student_id uuid,
    p_required_action text,
    p_required_resource text
)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, users, authz, app
AS $function$
    SELECT p_tenant_id IS NOT NULL
       AND p_student_id IS NOT NULL
       AND p_required_action IS NOT NULL
       AND p_required_resource IS NOT NULL
       AND EXISTS (
            SELECT 1
            FROM authz.request_contexts AS context
            JOIN authz.actor_tenant_authorizations AS grant_row
              ON grant_row.actor_id = context.actor_id
             AND grant_row.tenant_id = p_tenant_id
             AND grant_row.authz_revision = context.authz_revision
             AND grant_row.is_authorized
             AND (grant_row.expires_at IS NULL OR grant_row.expires_at > clock_timestamp())
            WHERE context.context_id = app.current_context_id()
              AND context.backend_pid = pg_backend_pid()
              AND context.transaction_id = txid_current()
              AND context.expires_at > clock_timestamp()
              AND context.tenant_id = p_tenant_id
              AND context.action = p_required_action
              AND context.resource = p_required_resource
              AND (
                    grant_row.grant_kind IN ('platform', 'tenant')
                    OR (
                        grant_row.grant_kind = 'placement'
                        AND EXISTS (
                            SELECT 1
                            FROM users.student_department_memberships AS membership
                            WHERE membership.student_id = p_student_id
                              AND membership.tenant_id = p_tenant_id
                              AND membership.department_type = 'placement'
                              AND membership.department_id = grant_row.grant_source_id
                              AND membership.status = 'active'
                        )
                    )
              )
       )
$function$;

GRANT EXECUTE ON FUNCTION users.current_context_valid_student(uuid, uuid, text, text)
    TO aether_user_app;

RESET ROLE;
