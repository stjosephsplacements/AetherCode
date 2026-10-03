-- Complete User grant snapshots replace the legacy one-row-per-tenant
-- projection. Until a complete snapshot arrives, legacy grants fail closed.
SET ROLE aether_notification_owner;

ALTER TABLE authz.actor_tenant_authorizations RENAME COLUMN active TO is_authorized;
ALTER TABLE authz.actor_tenant_authorizations
    ADD COLUMN grant_kind text NOT NULL DEFAULT 'tenant',
    ADD COLUMN grant_source_id uuid;
UPDATE authz.actor_tenant_authorizations
SET grant_source_id = tenant_id
WHERE grant_source_id IS NULL;
ALTER TABLE authz.actor_tenant_authorizations ALTER COLUMN grant_source_id SET NOT NULL;
ALTER TABLE authz.actor_tenant_authorizations ALTER COLUMN grant_kind DROP DEFAULT;

CREATE TABLE authz.principal_authorization_revisions (
    actor_id uuid PRIMARY KEY,
    authz_revision bigint NOT NULL CHECK (authz_revision > 0),
    snapshot_applied boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO authz.principal_authorization_revisions (actor_id, authz_revision, updated_at)
SELECT actor_id, max(authz_revision), max(updated_at)
FROM authz.actor_tenant_authorizations
GROUP BY actor_id;

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

ALTER TABLE authz.actor_tenant_authorizations
    ADD PRIMARY KEY (actor_id, tenant_id, grant_kind, grant_source_id);
ALTER TABLE authz.actor_tenant_authorizations
    ADD CONSTRAINT actor_tenant_authorizations_snapshot_check CHECK (
        authz_revision > 0 AND (
            (is_authorized AND grant_kind IN ('platform', 'tenant', 'placement'))
            OR (NOT is_authorized AND grant_kind = 'revoked')
        )
    );
CREATE INDEX actor_tenant_authorizations_snapshot_idx
    ON authz.actor_tenant_authorizations (actor_id, authz_revision, tenant_id)
    WHERE is_authorized;

CREATE TABLE authz.authorization_snapshot_inbox_messages (
    event_id uuid PRIMARY KEY,
    payload_sha256 bytea NOT NULL CHECK (octet_length(payload_sha256) = 32),
    occurred_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    processed_at timestamptz,
    last_error text
);
CREATE INDEX authorization_snapshot_inbox_pending_idx
    ON authz.authorization_snapshot_inbox_messages (received_at)
    WHERE processed_at IS NULL;

CREATE OR REPLACE FUNCTION authz.has_tenant_authorization_at(
    p_actor_id uuid, p_tenant_id uuid, p_authz_revision bigint
)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz AS $function$
    SELECT p_tenant_id IS NOT NULL AND EXISTS (
        SELECT 1
        FROM authz.actor_tenant_authorizations AS grant_row
        JOIN authz.principal_authorization_revisions AS revision
          ON revision.actor_id = grant_row.actor_id
         AND revision.authz_revision = grant_row.authz_revision
         AND revision.snapshot_applied
        WHERE grant_row.actor_id = p_actor_id
          AND grant_row.authz_revision = p_authz_revision
          AND grant_row.is_authorized
          AND (grant_row.expires_at IS NULL OR grant_row.expires_at > clock_timestamp())
          AND (grant_row.grant_kind = 'platform' OR grant_row.tenant_id = p_tenant_id)
    )
$function$;

-- Kept only for a controlled migration transition; it can never turn an old
-- per-tenant grant into a trusted complete snapshot.
CREATE OR REPLACE FUNCTION authz.apply_tenant_authorization(
    p_actor_id uuid, p_tenant_id uuid, p_authz_revision bigint, p_active boolean,
    p_expires_at timestamptz DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, authz AS $function$
DECLARE current_revision bigint;
BEGIN
    IF p_actor_id IS NULL OR p_tenant_id IS NULL OR p_authz_revision <= 0 THEN
        RAISE EXCEPTION 'actor, tenant, and positive authorization revision are required';
    END IF;
    SELECT authz_revision INTO current_revision
    FROM authz.principal_authorization_revisions
    WHERE actor_id = p_actor_id
    FOR UPDATE;
    IF FOUND AND current_revision >= p_authz_revision THEN
        RETURN;
    END IF;
    INSERT INTO authz.principal_authorization_revisions AS revision (actor_id, authz_revision, snapshot_applied)
    VALUES (p_actor_id, p_authz_revision, false)
    ON CONFLICT (actor_id) DO UPDATE
    SET authz_revision = EXCLUDED.authz_revision, updated_at = clock_timestamp()
    WHERE EXCLUDED.authz_revision > revision.authz_revision;
    DELETE FROM authz.actor_tenant_authorizations WHERE actor_id = p_actor_id;
    INSERT INTO authz.actor_tenant_authorizations (
        actor_id, tenant_id, authz_revision, is_authorized, grant_kind, grant_source_id, expires_at
    ) VALUES (
        p_actor_id, p_tenant_id, p_authz_revision, p_active,
        CASE WHEN p_active THEN 'tenant' ELSE 'revoked' END,
        CASE WHEN p_active THEN p_tenant_id ELSE '00000000-0000-0000-0000-000000000000'::uuid END,
        p_expires_at
    );
END
$function$;

CREATE FUNCTION authz.apply_authorization_snapshot(
    p_actor_id uuid, p_authz_revision bigint, p_grants jsonb
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, authz AS $function$
DECLARE
    grant_item jsonb;
    grant_kind text;
    grant_tenant_id uuid;
    grant_source_id uuid;
    grant_expires_at timestamptz;
BEGIN
    IF p_actor_id IS NULL OR p_authz_revision <= 0 OR jsonb_typeof(p_grants) <> 'array' THEN
        RAISE EXCEPTION 'principal, positive authorization revision, and grants array are required';
    END IF;
    FOR grant_item IN SELECT value FROM jsonb_array_elements(p_grants) LOOP
        IF jsonb_typeof(grant_item) <> 'object' THEN
            RAISE EXCEPTION 'authorization grant must be an object';
        END IF;
        grant_kind := grant_item ->> 'grant_kind';
        BEGIN
            grant_tenant_id := NULLIF(grant_item ->> 'tenant_id', '')::uuid;
            grant_source_id := NULLIF(grant_item ->> 'grant_source_id', '')::uuid;
            grant_expires_at := NULLIF(grant_item ->> 'expires_at', '')::timestamptz;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'authorization grant contains an invalid UUID or timestamp';
        END;
        IF (grant_kind = 'platform'
                AND grant_tenant_id = '00000000-0000-0000-0000-000000000000'::uuid
                AND grant_source_id = '00000000-0000-0000-0000-000000000000'::uuid)
           OR (grant_kind = 'tenant'
                AND grant_tenant_id IS NOT NULL
                AND grant_tenant_id <> '00000000-0000-0000-0000-000000000000'::uuid
                AND grant_tenant_id = grant_source_id)
           OR (grant_kind = 'placement'
                AND grant_tenant_id IS NOT NULL
                AND grant_tenant_id <> '00000000-0000-0000-0000-000000000000'::uuid
                AND grant_source_id IS NOT NULL
                AND grant_source_id <> '00000000-0000-0000-0000-000000000000'::uuid)
        THEN
            CONTINUE;
        END IF;
        RAISE EXCEPTION 'authorization grant has an invalid scope';
    END LOOP;

    INSERT INTO authz.principal_authorization_revisions AS revision (actor_id, authz_revision, snapshot_applied)
    VALUES (p_actor_id, p_authz_revision, true)
    ON CONFLICT (actor_id) DO UPDATE
    SET authz_revision = EXCLUDED.authz_revision,
        snapshot_applied = true,
        updated_at = clock_timestamp()
    WHERE EXCLUDED.authz_revision > revision.authz_revision
       OR (EXCLUDED.authz_revision = revision.authz_revision AND NOT revision.snapshot_applied);
    IF NOT FOUND THEN
        RETURN false;
    END IF;

    DELETE FROM authz.actor_tenant_authorizations WHERE actor_id = p_actor_id;
    FOR grant_item IN SELECT value FROM jsonb_array_elements(p_grants) LOOP
        grant_kind := grant_item ->> 'grant_kind';
        grant_tenant_id := NULLIF(grant_item ->> 'tenant_id', '')::uuid;
        grant_source_id := NULLIF(grant_item ->> 'grant_source_id', '')::uuid;
        grant_expires_at := NULLIF(grant_item ->> 'expires_at', '')::timestamptz;
        INSERT INTO authz.actor_tenant_authorizations (
            actor_id, tenant_id, authz_revision, is_authorized, grant_kind, grant_source_id, expires_at
        ) VALUES (
            p_actor_id, grant_tenant_id, p_authz_revision, true,
            grant_kind, grant_source_id, grant_expires_at
        );
    END LOOP;
    RETURN true;
END
$function$;

REVOKE ALL ON TABLE authz.principal_authorization_revisions,
    authz.authorization_snapshot_inbox_messages FROM PUBLIC;
REVOKE ALL ON FUNCTION authz.apply_authorization_snapshot(uuid, bigint, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authz.apply_authorization_snapshot(uuid, bigint, jsonb)
    TO aether_notification_projection_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON authz.authorization_snapshot_inbox_messages
    TO aether_notification_projection_worker;
GRANT SELECT ON authz.principal_authorization_revisions TO aether_notification_authz_reader;

RESET ROLE;
