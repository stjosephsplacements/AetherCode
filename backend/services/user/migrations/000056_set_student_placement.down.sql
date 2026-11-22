SET ROLE aether_user_owner;

DROP FUNCTION IF EXISTS users.set_student_placement_department(uuid, uuid, uuid, uuid);

-- Restore pre-pool placement visibility (track members only).
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

SET LOCAL users.allow_managed_change = 'on';
UPDATE users.roles
SET permissions = users.flag_bits(ARRAY[
    'VIEW_SCOPE', 'VIEW_PLACEMENT_POOL', 'VIEW_STUDENT_PII', 'VIEW_GOLD_ANALYTICS',
    'user.students.read', 'user.student_batch_affiliations.read', 'user.student_batch_affiliations.write'
]),
    updated_at = clock_timestamp()
WHERE system_key = 'placement_officer' AND managed;

RESET ROLE;
