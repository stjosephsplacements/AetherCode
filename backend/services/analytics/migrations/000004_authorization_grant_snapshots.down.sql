SET ROLE aether_analytics_owner;

DROP FUNCTION IF EXISTS authz.apply_authorization_snapshot(uuid, bigint, jsonb);

DO $rollback_guard$
BEGIN
    IF EXISTS (
        SELECT 1 FROM authz.actor_tenant_authorizations
        WHERE grant_kind <> 'tenant' OR NOT is_authorized
    ) THEN
        RAISE EXCEPTION 'cannot roll back complete authorization snapshots with non-tenant grants or revocations';
    END IF;
END
$rollback_guard$;

DROP FUNCTION authz.apply_tenant_authorization(uuid, uuid, bigint, boolean, timestamptz);
DROP TABLE authz.authorization_snapshot_inbox_messages;
DROP TABLE authz.principal_authorization_revisions;

DO $constraints$
DECLARE constraint_name text;
BEGIN
    FOR constraint_name IN
        SELECT constraint_item.conname
        FROM pg_constraint AS constraint_item
        WHERE constraint_item.conrelid = 'authz.actor_tenant_authorizations'::regclass
          AND constraint_item.contype IN ('p', 'c')
    LOOP
        EXECUTE format('ALTER TABLE authz.actor_tenant_authorizations DROP CONSTRAINT %I', constraint_name);
    END LOOP;
END
$constraints$;

ALTER TABLE authz.actor_tenant_authorizations DROP COLUMN grant_source_id;
ALTER TABLE authz.actor_tenant_authorizations DROP COLUMN grant_kind;
ALTER TABLE authz.actor_tenant_authorizations RENAME COLUMN is_authorized TO active;
ALTER TABLE authz.actor_tenant_authorizations ADD PRIMARY KEY (actor_id, tenant_id);
ALTER TABLE authz.actor_tenant_authorizations
    ADD CONSTRAINT actor_tenant_authorizations_active_check CHECK (authz_revision > 0);

CREATE OR REPLACE FUNCTION authz.has_tenant_authorization_at(p_actor_id uuid, p_tenant_id uuid, p_authz_revision bigint)
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

CREATE FUNCTION authz.apply_tenant_authorization(
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

REVOKE ALL ON FUNCTION authz.apply_tenant_authorization(uuid, uuid, bigint, boolean, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authz.apply_tenant_authorization(uuid, uuid, bigint, boolean, timestamptz)
    TO aether_analytics_projection_worker;

RESET ROLE;
