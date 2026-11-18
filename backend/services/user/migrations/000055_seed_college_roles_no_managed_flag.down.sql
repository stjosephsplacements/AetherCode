SET ROLE aether_user_owner;

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

RESET ROLE;
