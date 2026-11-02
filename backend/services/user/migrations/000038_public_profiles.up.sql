-- A student's opt-in public profile (ADR-0062). The row is reachable only through
-- the functions below: the app role has no table grant, so nothing reads it by accident.

SET ROLE aether_user_owner;

CREATE TABLE users.public_profiles (
    principal_id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{2,30}$'),
    enabled boolean NOT NULL DEFAULT false,
    content jsonb NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(content) = 'object' AND octet_length(content::text) <= 8192),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE users.public_profiles ENABLE ROW LEVEL SECURITY;

-- Anyone may read an enabled profile by its slug; nothing else is returned.
CREATE FUNCTION users.public_profile_by_slug(p_slug text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, users AS $function$
    SELECT jsonb_build_object('slug', slug, 'content', content, 'updated_at', updated_at)
    FROM users.public_profiles
    WHERE slug = p_slug AND enabled
$function$;

-- The signed-in student's own settings, whether or not they are public.
CREATE FUNCTION users.own_public_profile(p_tenant_id uuid)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, users, authz AS $function$
    SELECT CASE WHEN authz.current_context_allows(p_tenant_id, 'user.read', 'users.profiles')
        THEN COALESCE(
            (SELECT jsonb_build_object('slug', slug, 'enabled', enabled, 'content', content, 'updated_at', updated_at)
             FROM users.public_profiles WHERE principal_id = authz.current_context_actor_id()),
            jsonb_build_object('slug', '', 'enabled', false, 'content', '{}'::jsonb))
    END
$function$;

CREATE FUNCTION users.set_own_public_profile(p_tenant_id uuid, p_slug text, p_enabled boolean, p_content jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, users, authz AS $function$
DECLARE
    actor uuid;
BEGIN
    IF NOT authz.current_context_allows(p_tenant_id, 'user.write', 'users.profiles') THEN
        RAISE EXCEPTION 'not allowed to edit this profile' USING ERRCODE = '42501';
    END IF;
    actor := authz.current_context_actor_id();
    IF actor IS NULL THEN
        RAISE EXCEPTION 'no signed context' USING ERRCODE = '42501';
    END IF;
    INSERT INTO users.public_profiles (principal_id, tenant_id, slug, enabled, content)
    VALUES (actor, p_tenant_id, p_slug, p_enabled, p_content)
    ON CONFLICT (principal_id) DO UPDATE
        SET slug = EXCLUDED.slug, enabled = EXCLUDED.enabled, content = EXCLUDED.content, updated_at = clock_timestamp();
    RETURN (SELECT jsonb_build_object('slug', slug, 'enabled', enabled, 'content', content, 'updated_at', updated_at)
            FROM users.public_profiles WHERE principal_id = actor);
END
$function$;

REVOKE ALL ON FUNCTION users.public_profile_by_slug(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION users.own_public_profile(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION users.set_own_public_profile(uuid, text, boolean, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION users.public_profile_by_slug(text) TO aether_user_app;
GRANT EXECUTE ON FUNCTION users.own_public_profile(uuid) TO aether_user_app;
GRANT EXECUTE ON FUNCTION users.set_own_public_profile(uuid, text, boolean, jsonb) TO aether_user_app;

RESET ROLE;
