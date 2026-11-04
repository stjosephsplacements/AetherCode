-- Custom roles with the hierarchy and grant ceiling enforced in the database (ADR-0066).
-- Additive: legacy enum assignments keep working. Triggers apply to the application role only;
-- the maintenance role (migrations, seeds) is not limited.
SET ROLE aether_user_owner;

-- New flags for the role endpoints. The registry is append-only (migration 000039).
INSERT INTO users.permission_flags (key, bit_index, kind, elevated, platform_only) VALUES
    ('user.roles.read', 193, 'resource', false, false),
    ('user.roles.write', 194, 'resource', false, false),
    ('user.roles.delete', 195, 'resource', false, false),
    ('user.role_overwrites.read', 196, 'resource', false, false),
    ('user.role_overwrites.write', 197, 'resource', false, false),
    ('user.role_overwrites.delete', 198, 'resource', false, false);

-- A custom role is assigned through role_assignments like any other, by role_id.
ALTER TABLE users.role_assignments DROP CONSTRAINT role_assignments_role_name_check;
ALTER TABLE users.role_assignments ADD CONSTRAINT role_assignments_role_name_check CHECK (role_name IN (
    'super_admin', 'placement_user', 'college_admin', 'department_user', 'mentor', 'student', 'custom'
));
ALTER TABLE users.role_assignments DROP CONSTRAINT role_assignments_check3;
ALTER TABLE users.role_assignments ADD CONSTRAINT role_assignments_check3 CHECK (
    (role_name = 'super_admin' AND scope_kind = 'platform')
    OR (role_name = 'placement_user' AND scope_kind IN ('platform', 'placement_department'))
    OR (role_name = 'college_admin' AND scope_kind = 'college')
    OR (role_name = 'department_user' AND scope_kind = 'department')
    OR (role_name = 'mentor' AND scope_kind IN ('department', 'batch'))
    OR (role_name = 'student' AND scope_kind = 'self')
    OR (role_name = 'custom' AND role_id IS NOT NULL AND scope_kind IN ('college', 'department', 'batch'))
);

-- Every active assignment with its role row: the explicit role_id, or the managed role the legacy
-- role name stands for (the root administrator is the Owner, placement users the Placement officer).
CREATE VIEW users.assignment_roles WITH (security_barrier = true) AS
SELECT a.id AS assignment_id, a.principal_id, a.tenant_id, a.scope_kind, a.scope_id, r.id AS role_id,
       r.guild_kind, r.tier, r.position, r.permissions
FROM users.role_assignments AS a
JOIN users.roles AS r
  ON r.id = a.role_id
  OR (a.role_id IS NULL
      AND r.guild_kind = CASE a.role_name WHEN 'super_admin' THEN 'platform' WHEN 'placement_user' THEN 'placement' ELSE 'college' END
      AND r.tenant_id IS NOT DISTINCT FROM CASE WHEN a.role_name IN ('super_admin', 'placement_user') THEN NULL ELSE a.tenant_id END
      AND r.system_key = CASE
            WHEN a.role_name = 'super_admin' AND a.granted_by_principal_id = a.principal_id THEN 'owner'
            WHEN a.role_name = 'placement_user' THEN 'placement_officer'
            ELSE a.role_name END)
WHERE a.status = 'active' AND (a.expires_at IS NULL OR a.expires_at > clock_timestamp()) AND a.deleted_at IS NULL;
GRANT SELECT ON users.assignment_roles TO aether_user_authz_reader;

-- rank = tier * 100000 + position: the tier dominates, as in the Go library.
CREATE FUNCTION users.principal_rank(p_principal uuid, p_tenant uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, users AS $function$
    SELECT max(tier * 100000 + position) FROM users.assignment_roles
    WHERE principal_id = p_principal AND (guild_kind = 'platform' OR tenant_id = p_tenant);
$function$;

CREATE FUNCTION users.principal_bits(p_principal uuid, p_tenant uuid)
RETURNS bit(256) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, users AS $function$
    SELECT CASE WHEN get_bit(b, 0) = 1 THEN repeat('1', 256)::bit(256) ELSE b END
    FROM (SELECT COALESCE(bit_or(permissions), repeat('0', 256)::bit(256)) AS b FROM users.assignment_roles
          WHERE principal_id = p_principal AND (guild_kind = 'platform' OR tenant_id = p_tenant)) AS held;
$function$;

-- The acting administrator comes from the signed request context, never from the request.
CREATE FUNCTION users.enforce_role_hierarchy()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, users AS $function$
DECLARE
    v_actor uuid := authz.current_context_actor_id();
    v_tenant uuid := COALESCE(NEW.tenant_id, OLD.tenant_id);
    v_rank integer;
    v_bits bit(256);
BEGIN
    IF current_user <> 'aether_user_app' THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'roles change only inside an authorised request' USING ERRCODE = '42501';
    END IF;
    v_rank := users.principal_rank(v_actor, v_tenant);
    v_bits := users.principal_bits(v_actor, v_tenant);
    IF v_rank IS NULL THEN
        RAISE EXCEPTION 'the acting member holds no role in this college' USING ERRCODE = '42501';
    END IF;
    IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.tier * 100000 + OLD.position >= v_rank THEN
        RAISE EXCEPTION 'a role at or above your own cannot be changed' USING ERRCODE = '42501';
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        IF NEW.tier NOT IN (1, 2) THEN
            RAISE EXCEPTION 'a college role is Silver or Bronze' USING ERRCODE = '42501';
        END IF;
        IF NEW.tier * 100000 + NEW.position >= v_rank THEN
            RAISE EXCEPTION 'a role must rank below your own' USING ERRCODE = '42501';
        END IF;
        IF get_bit(v_bits, 0) = 0 AND (NEW.permissions & ~v_bits) <> repeat('0', 256)::bit(256) THEN
            RAISE EXCEPTION 'a role cannot hold permissions you do not hold' USING ERRCODE = '42501';
        END IF;
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$function$;
CREATE TRIGGER roles_enforce_hierarchy BEFORE INSERT OR UPDATE OR DELETE ON users.roles
    FOR EACH ROW EXECUTE FUNCTION users.enforce_role_hierarchy();

CREATE FUNCTION users.enforce_custom_assignment()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, users AS $function$
DECLARE
    v_actor uuid := authz.current_context_actor_id();
    v_tenant uuid := COALESCE(NEW.tenant_id, OLD.tenant_id);
    v_rank integer;
    v_role integer;
    v_member integer;
BEGIN
    IF current_user <> 'aether_user_app' OR COALESCE(NEW.role_name, OLD.role_name) <> 'custom' THEN
        RETURN NEW;
    END IF;
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'roles are assigned only inside an authorised request' USING ERRCODE = '42501';
    END IF;
    v_rank := users.principal_rank(v_actor, v_tenant);
    SELECT tier * 100000 + position INTO v_role FROM users.roles WHERE id = COALESCE(NEW.role_id, OLD.role_id);
    v_member := users.principal_rank(COALESCE(NEW.principal_id, OLD.principal_id), v_tenant);
    IF v_rank IS NULL OR v_role IS NULL OR v_role >= v_rank THEN
        RAISE EXCEPTION 'you can only assign roles below your own' USING ERRCODE = '42501';
    END IF;
    IF v_member IS NOT NULL AND v_member >= v_rank THEN
        RAISE EXCEPTION 'you cannot change the roles of a member at or above your own rank' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END
$function$;
CREATE TRIGGER role_assignments_enforce_custom BEFORE INSERT OR UPDATE ON users.role_assignments
    FOR EACH ROW EXECUTE FUNCTION users.enforce_custom_assignment();

CREATE FUNCTION users.enforce_overwrite_hierarchy()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, users AS $function$
DECLARE
    v_actor uuid := authz.current_context_actor_id();
    v_tenant uuid := COALESCE(NEW.tenant_id, OLD.tenant_id);
    v_rank integer;
    v_bits bit(256);
    v_target integer;
    v_target_kind text := COALESCE(NEW.target_kind, OLD.target_kind);
    v_target_id uuid := COALESCE(NEW.target_id, OLD.target_id);
BEGIN
    IF current_user <> 'aether_user_app' THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'overwrites change only inside an authorised request' USING ERRCODE = '42501';
    END IF;
    v_rank := users.principal_rank(v_actor, v_tenant);
    v_bits := users.principal_bits(v_actor, v_tenant);
    IF v_target_kind = 'role' THEN
        SELECT tier * 100000 + position INTO v_target FROM users.roles WHERE id = v_target_id AND tenant_id = v_tenant;
    ELSE
        v_target := users.principal_rank(v_target_id, v_tenant);
    END IF;
    IF v_rank IS NULL OR (v_target_kind = 'role' AND v_target IS NULL) OR (v_target IS NOT NULL AND v_target >= v_rank) THEN
        RAISE EXCEPTION 'overwrites apply only to roles and members below your own rank' USING ERRCODE = '42501';
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') AND get_bit(v_bits, 0) = 0
       AND (NEW.allow & ~v_bits) <> repeat('0', 256)::bit(256) THEN
        RAISE EXCEPTION 'an overwrite cannot allow permissions you do not hold' USING ERRCODE = '42501';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$function$;
CREATE TRIGGER permission_overwrites_enforce_hierarchy BEFORE INSERT OR UPDATE OR DELETE ON users.permission_overwrites
    FOR EACH ROW EXECUTE FUNCTION users.enforce_overwrite_hierarchy();

REVOKE ALL ON FUNCTION users.principal_rank(uuid, uuid), users.principal_bits(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION users.principal_rank(uuid, uuid), users.principal_bits(uuid, uuid) TO aether_user_app;

-- Row-level security for the application role: college roles and overwrites of one's own college.
CREATE POLICY permission_flags_app_read ON users.permission_flags FOR SELECT TO aether_user_app USING (true);
CREATE POLICY roles_app_read ON users.roles FOR SELECT TO aether_user_app
    USING (guild_kind = 'college' AND (authz.current_context_allows(tenant_id, 'user.read', 'users.roles')
        OR authz.current_context_allows(tenant_id, 'user.write', 'users.roles')));
CREATE POLICY roles_app_insert ON users.roles FOR INSERT TO aether_user_app
    WITH CHECK (guild_kind = 'college' AND NOT managed AND authz.current_context_allows(tenant_id, 'user.write', 'users.roles'));
CREATE POLICY roles_app_update ON users.roles FOR UPDATE TO aether_user_app
    USING (guild_kind = 'college' AND NOT managed AND authz.current_context_allows(tenant_id, 'user.write', 'users.roles'))
    WITH CHECK (guild_kind = 'college' AND NOT managed AND authz.current_context_allows(tenant_id, 'user.write', 'users.roles'));
CREATE POLICY roles_app_delete ON users.roles FOR DELETE TO aether_user_app
    USING (guild_kind = 'college' AND NOT managed AND authz.current_context_allows(tenant_id, 'user.write', 'users.roles'));

CREATE POLICY overwrites_app_read ON users.permission_overwrites FOR SELECT TO aether_user_app
    USING (tenant_id IS NOT NULL AND (authz.current_context_allows(tenant_id, 'user.read', 'users.role_overwrites')
        OR authz.current_context_allows(tenant_id, 'user.write', 'users.role_overwrites')));
CREATE POLICY overwrites_app_insert ON users.permission_overwrites FOR INSERT TO aether_user_app
    WITH CHECK (tenant_id IS NOT NULL AND authz.current_context_allows(tenant_id, 'user.write', 'users.role_overwrites'));
CREATE POLICY overwrites_app_update ON users.permission_overwrites FOR UPDATE TO aether_user_app
    USING (tenant_id IS NOT NULL AND authz.current_context_allows(tenant_id, 'user.write', 'users.role_overwrites'))
    WITH CHECK (tenant_id IS NOT NULL AND authz.current_context_allows(tenant_id, 'user.write', 'users.role_overwrites'));
CREATE POLICY overwrites_app_delete ON users.permission_overwrites FOR DELETE TO aether_user_app
    USING (tenant_id IS NOT NULL AND authz.current_context_allows(tenant_id, 'user.write', 'users.role_overwrites'));

GRANT SELECT ON users.permission_flags TO aether_user_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON users.roles, users.permission_overwrites TO aether_user_app;

RESET ROLE;
