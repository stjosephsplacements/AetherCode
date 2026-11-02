-- The first super_admin (self-granted at bootstrap) is the root administrator:
-- its access is fixed. A super_admin granted by someone else is delegated: it
-- holds only the permissions the root gives it (ADR-0061).

SET ROLE aether_user_owner;

-- Authorization needs to tell the two apart, so the view now carries the granter.
CREATE OR REPLACE VIEW users.active_role_assignments
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
    assignment.expires_at,
    assignment.granted_by_principal_id
FROM users.role_assignments AS assignment
JOIN users.authz_revisions AS revision ON revision.principal_id = assignment.principal_id
WHERE assignment.status = 'active'
  AND (assignment.expires_at IS NULL OR assignment.expires_at > clock_timestamp());

CREATE FUNCTION users.is_root_administrator(p_principal_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, users AS $function$
    SELECT EXISTS (
        SELECT 1 FROM users.role_assignments
        WHERE principal_id = p_principal_id
          AND role_name = 'super_admin' AND scope_kind = 'platform'
          AND granted_by_principal_id = principal_id
          AND status = 'active' AND deleted_at IS NULL
    );
$function$;
REVOKE ALL ON FUNCTION users.is_root_administrator(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION users.is_root_administrator(uuid) TO aether_user_app;

-- The root's access cannot be revoked or edited away, whatever the caller.
CREATE FUNCTION users.protect_root_assignment()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, users AS $function$
BEGIN
    IF OLD.role_name = 'super_admin' AND OLD.scope_kind = 'platform'
       AND OLD.granted_by_principal_id = OLD.principal_id AND OLD.status = 'active'
       AND (NEW.status <> 'active' OR NEW.deleted_at IS NOT NULL OR NEW.role_name <> OLD.role_name
            OR NEW.scope_kind <> OLD.scope_kind OR NEW.principal_id <> OLD.principal_id) THEN
        RAISE EXCEPTION 'the root administrator cannot be revoked or changed' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END
$function$;

CREATE TRIGGER role_assignments_protect_root
    BEFORE UPDATE ON users.role_assignments
    FOR EACH ROW EXECUTE FUNCTION users.protect_root_assignment();

RESET ROLE;
