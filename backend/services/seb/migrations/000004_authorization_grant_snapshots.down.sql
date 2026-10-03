SET ROLE aether_seb_owner;

REVOKE EXECUTE ON FUNCTION authz.apply_authorization_snapshot(uuid, bigint, jsonb)
    FROM aether_seb_projection_worker;
REVOKE SELECT, INSERT, UPDATE, DELETE ON authz.authorization_snapshot_inbox_messages
    FROM aether_seb_projection_worker;
DROP FUNCTION authz.apply_authorization_snapshot(uuid, bigint, jsonb);
DROP TABLE authz.authorization_snapshot_inbox_messages;
DROP INDEX IF EXISTS authz.actor_tenant_authorizations_snapshot_idx;

DELETE FROM authz.actor_tenant_authorizations
WHERE grant_kind = 'platform';
WITH ranked_grants AS (
    SELECT ctid,
           row_number() OVER (
               PARTITION BY actor_id, tenant_id
               ORDER BY authz_revision DESC, updated_at DESC, grant_kind, grant_source_id
           ) AS position
    FROM authz.actor_tenant_authorizations
)
DELETE FROM authz.actor_tenant_authorizations AS grant_row
USING ranked_grants AS ranked_grant
WHERE grant_row.ctid = ranked_grant.ctid AND ranked_grant.position > 1;

ALTER TABLE authz.actor_tenant_authorizations
    DROP CONSTRAINT actor_tenant_authorizations_snapshot_check;
ALTER TABLE authz.actor_tenant_authorizations
    DROP CONSTRAINT actor_tenant_authorizations_pkey;
ALTER TABLE authz.actor_tenant_authorizations DROP COLUMN grant_source_id;
ALTER TABLE authz.actor_tenant_authorizations DROP COLUMN grant_kind;
ALTER TABLE authz.actor_tenant_authorizations RENAME COLUMN is_authorized TO active;
ALTER TABLE authz.actor_tenant_authorizations
    ADD PRIMARY KEY (actor_id, tenant_id);
ALTER TABLE authz.actor_tenant_authorizations
    ADD CONSTRAINT actor_tenant_authorizations_legacy_revision_check
    CHECK (authz_revision > 0);

CREATE OR REPLACE FUNCTION authz.has_tenant_authorization_at(
    p_actor_id uuid, p_tenant_id uuid, p_authz_revision bigint
)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz AS $function$
    SELECT EXISTS (
        SELECT 1 FROM authz.actor_tenant_authorizations AS authorization_row
        WHERE authorization_row.actor_id = p_actor_id
          AND authorization_row.tenant_id = p_tenant_id
          AND authorization_row.authz_revision = p_authz_revision
          AND authorization_row.active
          AND (authorization_row.expires_at IS NULL OR authorization_row.expires_at > clock_timestamp())
    )
$function$;

CREATE OR REPLACE FUNCTION authz.apply_tenant_authorization(
    p_actor_id uuid, p_tenant_id uuid, p_authz_revision bigint, p_active boolean,
    p_expires_at timestamptz DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, authz AS $function$
BEGIN
    IF p_actor_id IS NULL OR p_tenant_id IS NULL OR p_authz_revision <= 0 THEN
        RAISE EXCEPTION 'actor, tenant, and positive authorization revision are required';
    END IF;
    INSERT INTO authz.actor_tenant_authorizations AS authorization_row (
        actor_id, tenant_id, authz_revision, active, expires_at, updated_at
    ) VALUES (p_actor_id, p_tenant_id, p_authz_revision, p_active, p_expires_at, clock_timestamp())
    ON CONFLICT (actor_id, tenant_id) DO UPDATE SET
        authz_revision = EXCLUDED.authz_revision,
        active = EXCLUDED.active,
        expires_at = EXCLUDED.expires_at,
        updated_at = clock_timestamp()
    WHERE EXCLUDED.authz_revision > authorization_row.authz_revision;
END
$function$;

DROP TABLE authz.principal_authorization_revisions;

RESET ROLE;
