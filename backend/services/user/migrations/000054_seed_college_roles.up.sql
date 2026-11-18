SET ROLE aether_user_owner;

-- A new college had no roles at all: users.ensure_guild_roles is owner-only and nothing called it for a college created
-- after migration 000039, so its staff and students held no permission bits. Every college appears in
-- users.tenant_department_projections when its first department is projected, so seed the managed roles there.
-- ensure_guild_roles is idempotent (ON CONFLICT DO NOTHING).
CREATE OR REPLACE FUNCTION users.seed_college_roles_for_department()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, users AS $function$
BEGIN
    IF NEW.department_type = 'college' AND NEW.tenant_id IS NOT NULL THEN
        PERFORM set_config('users.allow_managed_change', 'on', true);
        PERFORM users.ensure_guild_roles('college', NEW.tenant_id);
    END IF;
    RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION users.seed_college_roles_for_department() FROM PUBLIC;

DROP TRIGGER IF EXISTS tenant_department_seed_college_roles ON users.tenant_department_projections;
CREATE TRIGGER tenant_department_seed_college_roles
    AFTER INSERT ON users.tenant_department_projections
    FOR EACH ROW EXECUTE FUNCTION users.seed_college_roles_for_department();

-- Colleges created before this migration.
SELECT set_config('users.allow_managed_change', 'on', true);
SELECT users.ensure_guild_roles('college', tenant_id)
FROM (SELECT DISTINCT tenant_id FROM users.tenant_department_projections
      WHERE department_type = 'college' AND tenant_id IS NOT NULL) AS colleges;

RESET ROLE;
