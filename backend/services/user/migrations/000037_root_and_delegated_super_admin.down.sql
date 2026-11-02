SET ROLE aether_user_owner;

DROP TRIGGER IF EXISTS role_assignments_protect_root ON users.role_assignments;
DROP FUNCTION IF EXISTS users.protect_root_assignment();
DROP FUNCTION IF EXISTS users.is_root_administrator(uuid);

DROP VIEW users.active_role_assignments;
CREATE VIEW users.active_role_assignments
WITH (security_barrier = true, security_invoker = true)
AS
SELECT
    assignment.id,
    assignment.principal_id,
    assignment.role_name,
    assignment.scope_kind,
    assignment.tenant_id,
    assignment.scope_id,
    revision.revision AS authz_revision,
    assignment.expires_at
FROM users.role_assignments AS assignment
JOIN users.authz_revisions AS revision ON revision.principal_id = assignment.principal_id
WHERE assignment.status = 'active'
  AND (assignment.expires_at IS NULL OR assignment.expires_at > clock_timestamp());
GRANT SELECT ON users.active_role_assignments TO aether_user_app;

RESET ROLE;
