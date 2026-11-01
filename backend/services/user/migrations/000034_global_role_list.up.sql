SET ROLE aether_user_owner;

ALTER POLICY role_assignments_app_read ON users.role_assignments
    USING (
        (tenant_id IS NOT NULL AND (
            authz.current_context_allows(tenant_id, 'user.read', 'users.role_assignments')
            OR authz.current_context_allows(tenant_id, 'user.write', 'users.role_assignments')
        ))
        OR (scope_kind = 'placement_department' AND (
            authz.current_context_allows_placement(scope_id, 'user.read', 'users.role_assignments')
            OR authz.current_context_allows_placement(scope_id, 'user.write', 'users.role_assignments')
        ))
        OR (
            authz.current_global_context_allows('user.read', 'users.role_assignments')
            OR authz.current_global_context_allows('user.write', 'users.role_assignments')
        )
    );

RESET ROLE;
