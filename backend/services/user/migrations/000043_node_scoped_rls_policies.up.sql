SET ROLE aether_user_owner;

-- Upgrade current_context_valid_student to enforce node-scoped capability checks.
-- The signed capability nodes array must cover the scope ID (department, batch,
-- or placement department) for scoped grants. College-level grants (kind IN
-- ('platform', 'tenant')) are unrestricted, matching the semantics of
-- current_context_covers_node where nodes IS NULL = unrestricted.

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
                    -- College-level grants: tenant or platform scope, nodes array is empty/NULL.
                    grant_row.grant_kind IN ('platform', 'tenant')

                    -- Department-scoped grant: node must be in the signed capability.
                    OR (
                        grant_row.grant_kind = 'department'
                        AND authz.current_context_covers_node(grant_row.grant_source_id)
                        AND EXISTS (
                            SELECT 1
                            FROM users.student_department_memberships AS membership
                            WHERE membership.student_id = p_student_id
                              AND membership.tenant_id = p_tenant_id
                              AND membership.department_type = 'college'
                              AND membership.department_id = grant_row.grant_source_id
                              AND membership.status = 'active'
                        )
                    )

                    -- Placement-department-scoped grant: node must be in the signed capability.
                    OR (
                        grant_row.grant_kind = 'placement'
                        AND authz.current_context_covers_node(grant_row.grant_source_id)
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

                    -- Batch-scoped grant: node must be in the signed capability.
                    OR (
                        grant_row.grant_kind = 'batch'
                        AND authz.current_context_covers_node(grant_row.grant_source_id)
                        AND EXISTS (
                            SELECT 1
                            FROM users.student_batch_memberships AS membership
                            WHERE membership.student_id = p_student_id
                              AND membership.tenant_id = p_tenant_id
                              AND membership.batch_id = grant_row.grant_source_id
                              AND membership.lifecycle_state = 'active'
                        )
                    )
              )
       )
$function$;

GRANT EXECUTE ON FUNCTION users.current_context_valid_student(uuid, uuid, text, text)
    TO aether_user_app;

-- Scoped-node policy for tenant_department_projections.
-- authz.current_context_covers_node already returns true when nodes IS NULL or
-- the array is empty (unrestricted context), so college-level admins pass
-- automatically. Department-scoped staff see only the row whose id is in the
-- signed capability nodes array.
ALTER TABLE users.tenant_department_projections ENABLE ROW LEVEL SECURITY;
ALTER TABLE users.tenant_department_projections FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_department_projections_owner_maintenance
    ON users.tenant_department_projections
    FOR ALL TO aether_user_owner
    USING (true) WITH CHECK (true);

-- Projection worker writes to this table without a signed authz context.
CREATE POLICY tenant_department_projections_projection_worker
    ON users.tenant_department_projections
    FOR ALL TO aether_user_projection_worker
    USING (true) WITH CHECK (true);

CREATE POLICY tenant_department_projections_app_read
    ON users.tenant_department_projections
    FOR SELECT TO aether_user_app
    USING (authz.current_context_covers_node(department_id));

-- Scoped-node policy for tenant_batch_projections.
ALTER TABLE users.tenant_batch_projections ENABLE ROW LEVEL SECURITY;
ALTER TABLE users.tenant_batch_projections FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_batch_projections_owner_maintenance
    ON users.tenant_batch_projections
    FOR ALL TO aether_user_owner
    USING (true) WITH CHECK (true);

-- Projection worker writes to this table without a signed authz context.
CREATE POLICY tenant_batch_projections_projection_worker
    ON users.tenant_batch_projections
    FOR ALL TO aether_user_projection_worker
    USING (true) WITH CHECK (true);

CREATE POLICY tenant_batch_projections_app_read
    ON users.tenant_batch_projections
    FOR SELECT TO aether_user_app
    USING (authz.current_context_covers_node(batch_id));

RESET ROLE;
