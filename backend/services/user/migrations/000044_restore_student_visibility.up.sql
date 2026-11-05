SET ROLE aether_user_owner;

-- 000043 rebuilt current_context_valid_student with two defects: it required grant_row.tenant_id to equal
-- the requested tenant for every grant, but platform grants carry no tenant, so a platform administrator
-- saw no students at all; and it dropped the principal_authorization_revisions check from 000006, so a
-- grant whose snapshot was not applied was still honoured. Its department and batch grant kinds do not
-- exist in actor_tenant_authorizations (platform, tenant, placement are the only ones).
--
-- Restored: the 000006 rules, plus node scope. A college-wide ('tenant') grant whose signed context lists
-- nodes (a department user's department, a mentor's batch) reaches only the students in those nodes.
-- A context without nodes is unrestricted, as before. Placement grants keep their placement-department rule.
CREATE OR REPLACE FUNCTION users.current_context_valid_student(
    p_tenant_id uuid, p_student_id uuid, p_required_action text, p_required_resource text
)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, users, authz, app
AS $function$
    SELECT p_tenant_id IS NOT NULL
       AND p_student_id IS NOT NULL
       AND p_required_action IS NOT NULL
       AND p_required_resource IS NOT NULL
       AND EXISTS (
            SELECT 1 FROM authz.request_contexts AS context
            JOIN authz.actor_tenant_authorizations AS grant_row
              ON grant_row.actor_id = context.actor_id
             AND grant_row.authz_revision = context.authz_revision
             AND grant_row.is_authorized
             AND (grant_row.expires_at IS NULL OR grant_row.expires_at > clock_timestamp())
            JOIN authz.principal_authorization_revisions AS revision
              ON revision.actor_id = grant_row.actor_id
             AND revision.authz_revision = grant_row.authz_revision
            WHERE context.context_id = app.current_context_id()
              AND context.backend_pid = pg_backend_pid()
              AND context.transaction_id = txid_current()
              AND context.expires_at > clock_timestamp()
              AND context.tenant_id = p_tenant_id
              AND context.action = p_required_action
              AND context.resource = p_required_resource
              AND (
                    grant_row.grant_kind = 'platform'
                    OR (
                        grant_row.grant_kind = 'tenant'
                        AND grant_row.tenant_id = p_tenant_id
                        AND (
                            context.nodes IS NULL
                            OR EXISTS (
                                SELECT 1 FROM users.student_department_memberships AS membership
                                WHERE membership.student_id = p_student_id
                                  AND membership.tenant_id = p_tenant_id
                                  AND membership.department_type = 'college'
                                  AND membership.status = 'active'
                                  AND membership.deleted_at IS NULL
                                  AND membership.department_id = ANY (context.nodes)
                            )
                            OR EXISTS (
                                SELECT 1 FROM users.student_batch_memberships AS batch_membership
                                WHERE batch_membership.student_id = p_student_id
                                  AND batch_membership.tenant_id = p_tenant_id
                                  AND batch_membership.lifecycle_state = 'active'
                                  AND batch_membership.batch_id = ANY (context.nodes)
                            )
                        )
                    )
                    OR (
                        grant_row.grant_kind = 'placement'
                        AND grant_row.tenant_id = p_tenant_id
                        AND EXISTS (
                            SELECT 1 FROM users.student_department_memberships AS membership
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

GRANT EXECUTE ON FUNCTION users.current_context_valid_student(uuid, uuid, text, text) TO aether_user_app;

RESET ROLE;
