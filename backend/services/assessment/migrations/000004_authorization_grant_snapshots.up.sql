-- The bootstrap projection could hold only one tenant row per principal and
-- had no durable revision tombstone. Keep that legacy table for controlled
-- compatibility, but make signed RLS contexts consult a complete grant
-- snapshot. A lagging or missing snapshot denies the request.
SET ROLE aether_assessment_owner;

CREATE TABLE authz.principal_authorization_revisions (
    actor_id uuid PRIMARY KEY,
    authz_revision bigint NOT NULL CHECK (authz_revision > 0),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE authz.authorization_grants (
    actor_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    grant_kind text NOT NULL CHECK (grant_kind IN ('platform', 'tenant', 'placement')),
    grant_source_id uuid NOT NULL,
    authz_revision bigint NOT NULL CHECK (authz_revision > 0),
    expires_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (actor_id, tenant_id, grant_kind, grant_source_id),
    CHECK (
        (grant_kind = 'platform'
            AND tenant_id = '00000000-0000-0000-0000-000000000000'::uuid
            AND grant_source_id = '00000000-0000-0000-0000-000000000000'::uuid)
        OR (grant_kind = 'tenant' AND tenant_id = grant_source_id)
        OR (grant_kind = 'placement')
    )
);
CREATE INDEX authorization_grants_revision_idx
    ON authz.authorization_grants (actor_id, authz_revision, tenant_id)
    WHERE expires_at IS NULL;

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

INSERT INTO authz.principal_authorization_revisions (actor_id, authz_revision, updated_at)
SELECT actor_id, max(authz_revision), max(updated_at)
FROM authz.actor_tenant_authorizations
GROUP BY actor_id
ON CONFLICT (actor_id) DO UPDATE
SET authz_revision = GREATEST(
        authz.principal_authorization_revisions.authz_revision,
        EXCLUDED.authz_revision
    ),
    updated_at = GREATEST(
        authz.principal_authorization_revisions.updated_at,
        EXCLUDED.updated_at
    );

INSERT INTO authz.authorization_grants (
    actor_id, tenant_id, grant_kind, grant_source_id, authz_revision, expires_at, updated_at
)
SELECT actor_id, tenant_id, 'tenant', tenant_id, authz_revision, expires_at, updated_at
FROM authz.actor_tenant_authorizations
WHERE active
ON CONFLICT (actor_id, tenant_id, grant_kind, grant_source_id) DO UPDATE
SET authz_revision = GREATEST(authz.authorization_grants.authz_revision, EXCLUDED.authz_revision),
    expires_at = EXCLUDED.expires_at,
    updated_at = GREATEST(authz.authorization_grants.updated_at, EXCLUDED.updated_at);

CREATE OR REPLACE FUNCTION authz.has_tenant_authorization_at(
    p_actor_id uuid, p_tenant_id uuid, p_authz_revision bigint
)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz AS $function$
    SELECT p_tenant_id IS NOT NULL AND EXISTS (
        SELECT 1
        FROM authz.principal_authorization_revisions AS revision
        JOIN authz.authorization_grants AS grant_row
          ON grant_row.actor_id = revision.actor_id
         AND grant_row.authz_revision = revision.authz_revision
        WHERE revision.actor_id = p_actor_id
          AND revision.authz_revision = p_authz_revision
          AND (grant_row.expires_at IS NULL OR grant_row.expires_at > clock_timestamp())
          AND (grant_row.grant_kind = 'platform' OR grant_row.tenant_id = p_tenant_id)
    )
$function$;

CREATE OR REPLACE FUNCTION authz.apply_authorization_snapshot(
    p_actor_id uuid, p_authz_revision bigint, p_grants jsonb
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, authz AS $function$
DECLARE
    grant_item jsonb;
    parsed_kind text;
    parsed_tenant_id uuid;
    parsed_source_id uuid;
    parsed_expires_at timestamptz;
BEGIN
    IF p_actor_id IS NULL OR p_authz_revision <= 0 OR jsonb_typeof(p_grants) <> 'array' THEN
        RAISE EXCEPTION 'principal, positive authorization revision, and grants array are required';
    END IF;

    FOR grant_item IN SELECT value FROM jsonb_array_elements(p_grants) LOOP
        IF jsonb_typeof(grant_item) <> 'object' THEN
            RAISE EXCEPTION 'authorization grant must be an object';
        END IF;
        parsed_kind := grant_item ->> 'grant_kind';
        BEGIN
            parsed_tenant_id := NULLIF(grant_item ->> 'tenant_id', '')::uuid;
            parsed_source_id := NULLIF(grant_item ->> 'grant_source_id', '')::uuid;
            parsed_expires_at := NULLIF(grant_item ->> 'expires_at', '')::timestamptz;
        EXCEPTION
            WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
                RAISE EXCEPTION 'authorization grant contains an invalid UUID or timestamp';
        END;
        IF (parsed_kind = 'platform'
                AND parsed_tenant_id = '00000000-0000-0000-0000-000000000000'::uuid
                AND parsed_source_id = '00000000-0000-0000-0000-000000000000'::uuid)
           OR (parsed_kind = 'tenant' AND parsed_tenant_id IS NOT NULL AND parsed_tenant_id = parsed_source_id)
           OR (parsed_kind = 'placement' AND parsed_tenant_id IS NOT NULL AND parsed_source_id IS NOT NULL)
        THEN
            CONTINUE;
        END IF;
        RAISE EXCEPTION 'authorization grant has an invalid scope';
    END LOOP;

    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_grants) AS item(value)
        GROUP BY value ->> 'grant_kind', value ->> 'tenant_id', value ->> 'grant_source_id'
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'authorization snapshot contains duplicate grants';
    END IF;

    INSERT INTO authz.principal_authorization_revisions AS revision (actor_id, authz_revision)
    VALUES (p_actor_id, p_authz_revision)
    ON CONFLICT (actor_id) DO UPDATE
    SET authz_revision = EXCLUDED.authz_revision, updated_at = clock_timestamp()
    WHERE EXCLUDED.authz_revision > revision.authz_revision;
    IF NOT FOUND THEN
        RETURN false;
    END IF;

    DELETE FROM authz.authorization_grants WHERE actor_id = p_actor_id;
    FOR grant_item IN SELECT value FROM jsonb_array_elements(p_grants) LOOP
        parsed_kind := grant_item ->> 'grant_kind';
        parsed_tenant_id := (grant_item ->> 'tenant_id')::uuid;
        parsed_source_id := (grant_item ->> 'grant_source_id')::uuid;
        parsed_expires_at := NULLIF(grant_item ->> 'expires_at', '')::timestamptz;
        INSERT INTO authz.authorization_grants (
            actor_id, tenant_id, grant_kind, grant_source_id, authz_revision, expires_at
        ) VALUES (
            p_actor_id, parsed_tenant_id, parsed_kind, parsed_source_id, p_authz_revision, parsed_expires_at
        );
    END LOOP;
    RETURN true;
END
$function$;

-- Keep the old worker entry point usable during a rolling migration. Its
-- single-grant updates advance the same revision tombstone, so an old event
-- can never silently revive access at a later snapshot revision.
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
    WHERE EXCLUDED.authz_revision >= authorization_row.authz_revision;

    INSERT INTO authz.principal_authorization_revisions AS revision (actor_id, authz_revision)
    VALUES (p_actor_id, p_authz_revision)
    ON CONFLICT (actor_id) DO UPDATE
    SET authz_revision = EXCLUDED.authz_revision, updated_at = clock_timestamp()
    WHERE EXCLUDED.authz_revision > revision.authz_revision;
    IF NOT FOUND THEN
        RETURN;
    END IF;

    DELETE FROM authz.authorization_grants WHERE actor_id = p_actor_id;
    IF p_active THEN
        INSERT INTO authz.authorization_grants (
            actor_id, tenant_id, grant_kind, grant_source_id, authz_revision, expires_at
        ) VALUES (
            p_actor_id, p_tenant_id, 'tenant', p_tenant_id, p_authz_revision, p_expires_at
        );
    END IF;
END
$function$;

CREATE OR REPLACE FUNCTION authz.set_context(
    p_actor_id uuid, p_tenant_id uuid, p_authz_revision bigint, p_decision text,
    p_capability_id uuid, p_action text, p_resource text, p_issued_at timestamptz, p_expires_at timestamptz,
    p_key_id uuid, p_signature bytea
)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, authz, app, extensions AS $function$
DECLARE
    signing_key bytea;
    canonical_envelope text;
    context_id uuid;
    context_now timestamptz := clock_timestamp();
BEGIN
    IF p_actor_id IS NULL OR p_tenant_id IS NULL OR p_authz_revision <= 0 OR p_capability_id IS NULL OR p_key_id IS NULL
       OR p_signature IS NULL OR octet_length(p_signature) <> 32 OR p_decision <> 'allow'
       OR p_action !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'
       OR p_resource !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$'
       OR p_issued_at IS NULL OR p_expires_at IS NULL OR p_expires_at <= context_now
       OR p_issued_at > context_now + interval '1 second'
       OR p_issued_at < context_now - interval '5 seconds'
       OR p_expires_at > p_issued_at + interval '5 seconds' THEN
        RAISE EXCEPTION 'invalid signed authorization context' USING ERRCODE = '28000';
    END IF;

    SELECT key_material INTO signing_key
    FROM authz.context_keys
    WHERE key_id = p_key_id AND audience = current_database()
      AND not_before <= context_now AND not_after > context_now AND retired_at IS NULL;
    canonical_envelope := format(
        'aether-authz-context-v2|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s',
        current_database(), p_key_id, p_capability_id, p_actor_id, p_tenant_id, p_authz_revision, p_decision,
        p_action, p_resource,
        to_char(p_issued_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        to_char(p_expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    );
    IF signing_key IS NULL
       OR extensions.hmac(convert_to(canonical_envelope, 'UTF8'), signing_key, 'sha256') <> p_signature THEN
        RAISE EXCEPTION 'invalid signed authorization context' USING ERRCODE = '28000';
    END IF;
    IF NOT authz.has_tenant_authorization_at(p_actor_id, p_tenant_id, p_authz_revision) THEN
        RAISE EXCEPTION 'local authorization projection is not current' USING ERRCODE = '28000';
    END IF;

    PERFORM authz.purge_expired_contexts();
    PERFORM authz.purge_expired_capabilities();
    INSERT INTO authz.consumed_capabilities (capability_id, expires_at)
    VALUES (p_capability_id, p_expires_at)
    ON CONFLICT (capability_id) DO NOTHING;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'authorization capability has already been consumed' USING ERRCODE = '28000';
    END IF;
    context_id := extensions.gen_random_uuid();
    INSERT INTO authz.request_contexts (
        context_id, capability_id, backend_pid, transaction_id, actor_id, tenant_id, authz_revision,
        action, resource, issued_at, expires_at
    ) VALUES (
        context_id, p_capability_id, pg_backend_pid(), txid_current(), p_actor_id, p_tenant_id, p_authz_revision,
        p_action, p_resource, p_issued_at, p_expires_at
    ) ON CONFLICT (capability_id) DO NOTHING
    RETURNING authz.request_contexts.context_id INTO context_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'authorization capability has already been consumed' USING ERRCODE = '28000';
    END IF;
    PERFORM set_config('app.authz_context_id', context_id::text, true);
END
$function$;

REVOKE ALL ON TABLE authz.principal_authorization_revisions,
                    authz.authorization_grants,
                    authz.authorization_snapshot_inbox_messages
FROM PUBLIC;
REVOKE ALL ON FUNCTION authz.apply_authorization_snapshot(uuid, bigint, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authz.apply_authorization_snapshot(uuid, bigint, jsonb)
    TO aether_assessment_projection_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON authz.authorization_snapshot_inbox_messages
    TO aether_assessment_projection_worker;
GRANT SELECT ON authz.principal_authorization_revisions, authz.authorization_grants
    TO aether_assessment_authz_reader;

RESET ROLE;
