-- ensure_guild_roles only inserts (ON CONFLICT DO NOTHING), and roles_protect_managed fires only on UPDATE and DELETE,
-- so the trigger function did not need users.allow_managed_change. Setting it left the flag on for the rest of the
-- projection transaction. Migration 000054 stays as applied; this replaces the function without the setting.
SET ROLE aether_user_owner;

CREATE OR REPLACE FUNCTION users.seed_college_roles_for_department()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, users AS $function$
BEGIN
    IF NEW.department_type = 'college' AND NEW.tenant_id IS NOT NULL THEN
        PERFORM users.ensure_guild_roles('college', NEW.tenant_id);
    END IF;
    RETURN NEW;
END
$function$;

RESET ROLE;
