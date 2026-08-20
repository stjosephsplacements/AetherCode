-- Replace the legacy one-row-per-tenant authorization projection with the
-- complete, revisioned grant snapshot used by fail-closed RLS. A missing or
-- lagging local revision therefore denies a request rather than preserving a
-- revoked permission.
SET ROLE aether_submission_owner;

ALTER TABLE authz.actor_tenant_authorizations
    ADD COLUMN is_authorized boolean,
    ADD COLUMN grant_kind text,
    ADD COLUMN grant_source_id uuid;

UPDATE authz.actor_tenant_authorizations
SET is_authorized = active,
    grant_kind = 'tenant',
    grant_source_id = tenant_id
WHERE is_authorized IS NULL;

ALTER TABLE authz.actor_tenant_authorizations
    ALTER COLUMN is_authorized SET NOT NULL,
    ALTER COLUMN grant_kind SET NOT NULL,
    ALTER COLUMN grant_source_id SET NOT NULL;

CREATE TABLE authz.principal_authorization_revisions (
    actor_id uuid PRIMARY KEY,
    authz_revision bigint NOT NULL CHECK (authz_revision > 0),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO authz.principal_authorization_revisions (actor_id, authz_revision, updated_at)
SELECT actor_id, max(authz_revision), max(updated_at)
FROM authz.actor_tenant_authorizations
GROUP BY actor_id
ON CONFLICT (actor_id) DO UPDATE
SET authz_revision = GREATEST(authz.principal_authorization_revisions.authz_revision, EXCLUDED.authz_revision),
    updated_at = GREATEST(authz.principal_authorization_revisions.updated_at, EXCLUDED.updated_at);

-- The legacy inactive row represented a revocation. The new principal revision
-- ledger preserves that revocation even when the replacement grant set is empty.
DELETE FROM authz.actor_tenant_authorizations
WHERE NOT is_authorized;

DO $constraints$
DECLARE
    constraint_name text;
BEGIN
    FOR constraint_name IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'authz.actor_tenant_authorizations'::regclass
          AND contype IN ('p', 'c')
    LOOP
        EXECUTE format('ALTER TABLE authz.actor_tenant_authorizations DROP CONSTRAINT %I', constraint_name);
    END LOOP;
END
$constraints$;

ALTER TABLE authz.actor_tenant_authorizations DROP COLUMN active;
ALTER TABLE authz.actor_tenant_authorizations
    ADD PRIMARY KEY (actor_id, tenant_id, grant_kind, grant_source_id);
ALTER TABLE authz.actor_tenant_authorizations
    ADD CONSTRAINT actor_tenant_authorizations_snapshot_check CHECK (
        authz_revision > 0
        AND is_authorized
        AND grant_kind IN ('platform', 'tenant', 'placement')
        AND (
            (grant_kind = 'platform'
                AND tenant_id = '00000000-0000-0000-0000-000000000000'::uuid
                AND grant_source_id = '00000000-0000-0000-0000-000000000000'::uuid)
            OR (grant_kind = 'tenant' AND tenant_id = grant_source_id)
            OR grant_kind = 'placement'
        )
    );

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

CREATE OR REPLACE FUNCTION authz.has_platform_authorization_at(
    p_actor_id uuid,
    p_authz_revision bigint
)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, authz
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM authz.actor_tenant_authorizations AS grant_row
        JOIN authz.principal_authorization_revisions AS revision
          ON revision.actor_id = grant_row.actor_id
         AND revision.authz_revision = grant_row.authz_revision
        WHERE grant_row.actor_id = p_actor_id
          AND grant_row.authz_revision = p_authz_revision
          AND grant_row.is_authorized
          AND grant_row.grant_kind = 'platform'
          AND (grant_row.expires_at IS NULL OR grant_row.expires_at > clock_timestamp())
    )
$function$;

CREATE OR REPLACE FUNCTION authz.has_tenant_authorization_at(
    p_actor_id uuid,
    p_tenant_id uuid,
    p_authz_revision bigint
)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, authz
AS $function$
    SELECT p_tenant_id IS NOT NULL AND EXISTS (
        SELECT 1
        FROM authz.actor_tenant_authorizations AS grant_row
        JOIN authz.principal_authorization_revisions AS revision
          ON revision.actor_id = grant_row.actor_id
         AND revision.authz_revision = grant_row.authz_revision
        WHERE grant_row.actor_id = p_actor_id
          AND grant_row.authz_revision = p_authz_revision
          AND grant_row.is_authorized
          AND (grant_row.expires_at IS NULL OR grant_row.expires_at > clock_timestamp())
          AND (grant_row.grant_kind = 'platform' OR grant_row.tenant_id = p_tenant_id)
    )
$function$;

CREATE FUNCTION authz.current_context_actor_id()
RETURNS uuid
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, authz, app
AS $function$
    SELECT context.actor_id
    FROM authz.request_contexts AS context
    WHERE context.context_id = app.current_context_id()
      AND context.backend_pid = pg_backend_pid()
      AND context.transaction_id = txid_current()
      AND context.expires_at > clock_timestamp()
$function$;

DROP FUNCTION authz.apply_tenant_authorization(uuid, uuid, bigint, boolean, timestamptz);
CREATE FUNCTION authz.apply_tenant_authorization(
    p_actor_id uuid,
    p_tenant_id uuid,
    p_authz_revision bigint,
    p_is_authorized boolean,
    p_grant_kind text,
    p_grant_source_id uuid,
    p_expires_at timestamptz DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz
AS $function$
DECLARE
    normalized_tenant_id uuid;
    normalized_source_id uuid;
BEGIN
    IF p_actor_id IS NULL OR p_tenant_id IS NULL OR p_authz_revision <= 0
       OR NOT p_is_authorized
       OR p_grant_kind NOT IN ('platform', 'tenant', 'placement') THEN
        RAISE EXCEPTION 'actor, tenant, active grant, and positive authorization revision are required';
    END IF;

    normalized_tenant_id := CASE
        WHEN p_grant_kind = 'platform' THEN '00000000-0000-0000-0000-000000000000'::uuid
        ELSE p_tenant_id
    END;
    normalized_source_id := CASE
        WHEN p_grant_kind = 'platform' THEN '00000000-0000-0000-0000-000000000000'::uuid
        WHEN p_grant_kind = 'tenant' THEN p_tenant_id
        ELSE p_grant_source_id
    END;
    IF normalized_source_id IS NULL THEN
        RAISE EXCEPTION 'grant source is required for placement authorization';
    END IF;

    INSERT INTO authz.principal_authorization_revisions AS revision (actor_id, authz_revision)
    VALUES (p_actor_id, p_authz_revision)
    ON CONFLICT (actor_id) DO UPDATE
    SET authz_revision = EXCLUDED.authz_revision,
        updated_at = clock_timestamp()
    WHERE EXCLUDED.authz_revision >= revision.authz_revision;

    INSERT INTO authz.actor_tenant_authorizations AS grant_row (
        actor_id, tenant_id, authz_revision, is_authorized, grant_kind, grant_source_id, expires_at
    ) VALUES (
        p_actor_id, normalized_tenant_id, p_authz_revision, true,
        p_grant_kind, normalized_source_id, p_expires_at
    ) ON CONFLICT (actor_id, tenant_id, grant_kind, grant_source_id) DO UPDATE
    SET authz_revision = EXCLUDED.authz_revision,
        is_authorized = EXCLUDED.is_authorized,
        expires_at = EXCLUDED.expires_at,
        updated_at = clock_timestamp()
    WHERE EXCLUDED.authz_revision >= grant_row.authz_revision;
END
$function$;

CREATE FUNCTION authz.apply_authorization_snapshot(
    p_actor_id uuid,
    p_authz_revision bigint,
    p_grants jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz
AS $function$
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
        EXCEPTION
            WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
                RAISE EXCEPTION 'authorization grant contains an invalid UUID or timestamp';
        END;
        IF (grant_kind = 'platform'
                AND grant_tenant_id = '00000000-0000-0000-0000-000000000000'::uuid
                AND grant_source_id = '00000000-0000-0000-0000-000000000000'::uuid)
           OR (grant_kind = 'tenant' AND grant_tenant_id IS NOT NULL AND grant_tenant_id = grant_source_id)
           OR (grant_kind = 'placement' AND grant_tenant_id IS NOT NULL AND grant_source_id IS NOT NULL) THEN
            CONTINUE;
        END IF;
        RAISE EXCEPTION 'authorization grant has an invalid scope';
    END LOOP;

    INSERT INTO authz.principal_authorization_revisions AS revision (actor_id, authz_revision)
    VALUES (p_actor_id, p_authz_revision)
    ON CONFLICT (actor_id) DO UPDATE
    SET authz_revision = EXCLUDED.authz_revision,
        updated_at = clock_timestamp()
    WHERE EXCLUDED.authz_revision >= revision.authz_revision;
    IF NOT FOUND THEN
        RETURN false;
    END IF;

    DELETE FROM authz.actor_tenant_authorizations
    WHERE actor_id = p_actor_id;

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

REVOKE ALL ON TABLE authz.principal_authorization_revisions, authz.authorization_snapshot_inbox_messages FROM PUBLIC;
REVOKE ALL ON FUNCTION authz.has_platform_authorization_at(uuid, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION authz.current_context_actor_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION authz.apply_tenant_authorization(uuid, uuid, bigint, boolean, text, uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION authz.apply_authorization_snapshot(uuid, bigint, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authz.has_platform_authorization_at(uuid, bigint) TO aether_submission_app;
GRANT EXECUTE ON FUNCTION authz.current_context_actor_id() TO aether_submission_app;
GRANT EXECUTE ON FUNCTION authz.apply_authorization_snapshot(uuid, bigint, jsonb)
    TO aether_submission_projection_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON authz.authorization_snapshot_inbox_messages
    TO aether_submission_projection_worker;
GRANT SELECT ON authz.principal_authorization_revisions TO aether_submission_authz_reader;

RESET ROLE;
