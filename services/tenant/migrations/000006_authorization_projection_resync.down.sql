SET ROLE aether_tenant_owner;

CREATE OR REPLACE FUNCTION authz.has_platform_authorization_at(
    p_actor_id uuid, p_authz_revision bigint
)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz AS $function$
    SELECT EXISTS (
        SELECT 1 FROM authz.actor_tenant_authorizations AS grant_row
        JOIN authz.principal_authorization_revisions AS revision
          ON revision.actor_id = grant_row.actor_id AND revision.authz_revision = grant_row.authz_revision
        WHERE grant_row.actor_id = p_actor_id AND grant_row.authz_revision = p_authz_revision
          AND grant_row.is_authorized AND grant_row.grant_kind = 'platform'
          AND (grant_row.expires_at IS NULL OR grant_row.expires_at > clock_timestamp())
    )
$function$;

CREATE OR REPLACE FUNCTION authz.has_tenant_authorization_at(
    p_actor_id uuid, p_tenant_id uuid, p_authz_revision bigint
)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz AS $function$
    SELECT p_tenant_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM authz.actor_tenant_authorizations AS grant_row
        JOIN authz.principal_authorization_revisions AS revision
          ON revision.actor_id = grant_row.actor_id AND revision.authz_revision = grant_row.authz_revision
        WHERE grant_row.actor_id = p_actor_id AND grant_row.authz_revision = p_authz_revision
          AND grant_row.is_authorized
          AND (grant_row.expires_at IS NULL OR grant_row.expires_at > clock_timestamp())
          AND (grant_row.grant_kind = 'platform' OR grant_row.tenant_id = p_tenant_id)
    )
$function$;

REVOKE EXECUTE ON FUNCTION authz.begin_authorization_projection_resync(uuid, uuid, text, text)
    FROM aether_tenant_projection_worker;
REVOKE SELECT, INSERT, UPDATE, DELETE ON authz.authorization_projection_resync_state,
    authz.authorization_projection_resync_items FROM aether_tenant_projection_worker;
DROP FUNCTION authz.begin_authorization_projection_resync(uuid, uuid, text, text);
DROP FUNCTION authz.authorization_projection_ready();
DROP TABLE authz.authorization_projection_resync_items;
DROP TABLE authz.authorization_projection_resync_state;

RESET ROLE;
