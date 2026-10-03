SET ROLE aether_user_owner;

-- A principal can hold several placement grants in one tenant. The original
-- (actor_id, tenant_id) key could retain only one of them, so snapshots now
-- keep one row per effective grant plus a revision tombstone for an empty
-- (revoked) grant set.
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
SET authz_revision = GREATEST(
        authz.principal_authorization_revisions.authz_revision,
        EXCLUDED.authz_revision
    ),
    updated_at = GREATEST(
        authz.principal_authorization_revisions.updated_at,
        EXCLUDED.updated_at
    );

-- Normalize legacy rows before widening the primary key. A platform grant is
-- global and is therefore represented by the all-zero tenant/source sentinel;
-- the sentinel is never accepted as a request tenant ID.
WITH duplicate_platform_rows AS (
    SELECT ctid,
           row_number() OVER (
               PARTITION BY actor_id
               ORDER BY authz_revision DESC, updated_at DESC, ctid DESC
           ) AS position
    FROM authz.actor_tenant_authorizations
    WHERE grant_kind = 'platform'
)
DELETE FROM authz.actor_tenant_authorizations AS grant_row
USING duplicate_platform_rows AS duplicate_row
WHERE grant_row.ctid = duplicate_row.ctid
  AND duplicate_row.position > 1;

UPDATE authz.actor_tenant_authorizations
SET tenant_id = '00000000-0000-0000-0000-000000000000'::uuid,
    grant_source_id = '00000000-0000-0000-0000-000000000000'::uuid
WHERE grant_kind = 'platform';

UPDATE authz.actor_tenant_authorizations
SET grant_source_id = tenant_id
WHERE grant_kind = 'tenant' AND grant_source_id IS NULL;

UPDATE authz.actor_tenant_authorizations
SET grant_source_id = '00000000-0000-0000-0000-000000000000'::uuid
WHERE grant_kind = 'revoked' AND grant_source_id IS NULL;

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
    ALTER COLUMN grant_source_id SET NOT NULL;
ALTER TABLE authz.actor_tenant_authorizations
    ADD PRIMARY KEY (actor_id, tenant_id, grant_kind, grant_source_id);
ALTER TABLE authz.actor_tenant_authorizations
    ADD CONSTRAINT actor_tenant_authorizations_snapshot_check CHECK (
        authz_revision > 0 AND (
        (is_authorized AND grant_kind IN ('platform', 'tenant', 'placement'))
        OR (NOT is_authorized AND grant_kind = 'revoked')
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
    p_actor_id uuid, p_authz_revision bigint
)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz AS $function$
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
    p_actor_id uuid, p_tenant_id uuid, p_authz_revision bigint
)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz AS $function$
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
          AND (
              grant_row.grant_kind = 'platform'
              OR grant_row.tenant_id = p_tenant_id
          )
    )
$function$;

CREATE OR REPLACE FUNCTION authz.current_context_allows_placement(
    p_placement_department_id uuid, p_required_action text, p_required_resource text
)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz, app AS $function$
    SELECT p_placement_department_id IS NOT NULL
       AND p_required_action IS NOT NULL
       AND p_required_resource IS NOT NULL
       AND EXISTS (
            SELECT 1 FROM authz.request_contexts AS context
            JOIN authz.actor_tenant_authorizations AS grant_row
              ON grant_row.actor_id = context.actor_id
             AND grant_row.authz_revision = context.authz_revision
             AND grant_row.is_authorized
             AND (grant_row.expires_at IS NULL OR grant_row.expires_at > clock_timestamp())
            JOIN authz.principal_authorization_revisions AS revision
              ON revision.actor_id = grant_row.actor_id
             AND revision.authz_revision = grant_row.authz_revision
            WHERE context.context_id = app.current_context_id()
              AND context.backend_pid = pg_backend_pid()
              AND context.transaction_id = txid_current()
              AND context.expires_at > clock_timestamp()
              AND context.tenant_id IS NOT NULL
              AND context.action = p_required_action
              AND context.resource = p_required_resource
              AND (
                    grant_row.grant_kind = 'platform'
                    OR (grant_row.grant_kind = 'placement'
                        AND grant_row.tenant_id = context.tenant_id
                        AND grant_row.grant_source_id = p_placement_department_id)
              )
       )
$function$;

CREATE OR REPLACE FUNCTION authz.current_context_valid_placement(p_placement_department_id uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz, app AS $function$
    SELECT p_placement_department_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM authz.request_contexts AS context
        JOIN authz.actor_tenant_authorizations AS grant_row
          ON grant_row.actor_id = context.actor_id
         AND grant_row.authz_revision = context.authz_revision
         AND grant_row.is_authorized
         AND (grant_row.expires_at IS NULL OR grant_row.expires_at > clock_timestamp())
        JOIN authz.principal_authorization_revisions AS revision
          ON revision.actor_id = grant_row.actor_id
         AND revision.authz_revision = grant_row.authz_revision
        WHERE context.context_id = app.current_context_id()
          AND context.backend_pid = pg_backend_pid()
          AND context.transaction_id = txid_current()
          AND context.expires_at > clock_timestamp()
          AND context.tenant_id IS NOT NULL
          AND (
                grant_row.grant_kind = 'platform'
                OR (grant_row.grant_kind = 'placement'
                    AND grant_row.tenant_id = context.tenant_id
                    AND grant_row.grant_source_id = p_placement_department_id)
          )
    )
$function$;

CREATE OR REPLACE FUNCTION authz.apply_tenant_authorization(
    p_actor_id uuid, p_tenant_id uuid, p_authz_revision bigint, p_is_authorized boolean,
    p_grant_kind text, p_grant_source_id uuid, p_expires_at timestamptz DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, authz AS $function$
DECLARE
    normalized_tenant_id uuid;
    normalized_source_id uuid;
BEGIN
    IF p_actor_id IS NULL OR p_tenant_id IS NULL OR p_authz_revision <= 0
       OR p_grant_kind NOT IN ('platform', 'tenant', 'placement', 'revoked') THEN
        RAISE EXCEPTION 'actor, tenant, grant kind, and positive authorization revision are required';
    END IF;
    normalized_tenant_id := CASE WHEN p_grant_kind = 'platform'
        THEN '00000000-0000-0000-0000-000000000000'::uuid ELSE p_tenant_id END;
    normalized_source_id := CASE
        WHEN p_grant_kind IN ('platform', 'revoked') THEN '00000000-0000-0000-0000-000000000000'::uuid
        WHEN p_grant_kind = 'tenant' THEN p_tenant_id
        ELSE p_grant_source_id
    END;
    IF normalized_source_id IS NULL THEN
        RAISE EXCEPTION 'grant source is required for placement authorization';
    END IF;
    INSERT INTO authz.principal_authorization_revisions AS revision (actor_id, authz_revision)
    VALUES (p_actor_id, p_authz_revision)
    ON CONFLICT (actor_id) DO UPDATE
    SET authz_revision = EXCLUDED.authz_revision, updated_at = clock_timestamp()
    WHERE EXCLUDED.authz_revision >= revision.authz_revision;
    INSERT INTO authz.actor_tenant_authorizations AS grant_row (
        actor_id, tenant_id, authz_revision, is_authorized, grant_kind, grant_source_id, expires_at
    ) VALUES (
        p_actor_id, normalized_tenant_id, p_authz_revision, p_is_authorized,
        p_grant_kind, normalized_source_id, p_expires_at
    ) ON CONFLICT (actor_id, tenant_id, grant_kind, grant_source_id) DO UPDATE SET
        authz_revision = EXCLUDED.authz_revision, is_authorized = EXCLUDED.is_authorized,
        expires_at = EXCLUDED.expires_at, updated_at = clock_timestamp()
    WHERE EXCLUDED.authz_revision >= grant_row.authz_revision;
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
    applied_revision bigint;
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
        EXCEPTION WHEN invalid_text_representation THEN
            RAISE EXCEPTION 'authorization grant contains an invalid UUID or timestamp';
        END;
        IF (grant_kind = 'platform'
                AND grant_tenant_id = '00000000-0000-0000-0000-000000000000'::uuid
                AND grant_source_id = '00000000-0000-0000-0000-000000000000'::uuid)
           OR (grant_kind = 'tenant'
                AND grant_tenant_id IS NOT NULL
                AND grant_tenant_id = grant_source_id)
           OR (grant_kind = 'placement'
                AND grant_tenant_id IS NOT NULL
                AND grant_source_id IS NOT NULL)
        THEN
            CONTINUE;
        END IF;
        RAISE EXCEPTION 'authorization grant has an invalid scope';
    END LOOP;

    INSERT INTO authz.principal_authorization_revisions AS revision (actor_id, authz_revision)
    VALUES (p_actor_id, p_authz_revision)
    ON CONFLICT (actor_id) DO UPDATE
    SET authz_revision = EXCLUDED.authz_revision, updated_at = clock_timestamp()
    WHERE EXCLUDED.authz_revision >= revision.authz_revision
    RETURNING revision.authz_revision INTO applied_revision;
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

CREATE OR REPLACE FUNCTION authz.set_context(
    p_actor_id uuid, p_tenant_id uuid, p_authz_revision bigint, p_decision text,
    p_capability_id uuid, p_action text, p_resource text, p_issued_at timestamptz, p_expires_at timestamptz,
    p_key_id uuid, p_signature bytea
) RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, authz, app, extensions AS $function$
DECLARE
    context_key authz.context_keys%ROWTYPE;
    expected_signature bytea;
    canonical_envelope text;
    context_id uuid;
    v_now timestamptz := clock_timestamp();
BEGIN
    IF p_actor_id IS NULL OR p_authz_revision <= 0 OR p_capability_id IS NULL OR p_key_id IS NULL OR p_signature IS NULL
       OR octet_length(p_signature) <> 32 OR p_decision <> 'allow'
       OR p_action !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'
       OR p_resource !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$'
       OR p_issued_at IS NULL OR p_expires_at IS NULL OR p_expires_at <= v_now
       OR p_issued_at > v_now + interval '1 second'
       OR p_issued_at < v_now - interval '5 seconds'
       OR p_expires_at > p_issued_at + interval '5 seconds'
    THEN RAISE EXCEPTION 'invalid signed authorization context' USING ERRCODE = '28000'; END IF;
    SELECT key.* INTO context_key FROM authz.context_keys AS key
    WHERE key.key_id = p_key_id AND key.audience = current_database()
      AND key.not_before <= v_now AND key.not_after > v_now AND key.retired_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'authorization context key is unavailable' USING ERRCODE = '28000'; END IF;
    canonical_envelope := format(
        'aether-authz-context-v2|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s',
        current_database(), p_key_id, p_capability_id, p_actor_id, COALESCE(p_tenant_id::text, ''), p_authz_revision,
        p_decision, p_action, p_resource,
        to_char(p_issued_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        to_char(p_expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    );
    expected_signature := extensions.hmac(convert_to(canonical_envelope, 'UTF8'), context_key.key_material, 'sha256');
    IF expected_signature <> p_signature THEN RAISE EXCEPTION 'invalid signed authorization context' USING ERRCODE = '28000'; END IF;
    IF (p_tenant_id IS NOT NULL AND NOT authz.has_tenant_authorization_at(p_actor_id, p_tenant_id, p_authz_revision))
       OR (p_tenant_id IS NULL AND NOT authz.has_platform_authorization_at(p_actor_id, p_authz_revision))
    THEN RAISE EXCEPTION 'local authorization projection is not current' USING ERRCODE = '28000'; END IF;
    PERFORM authz.purge_expired_contexts();
    PERFORM authz.purge_expired_capabilities();
    INSERT INTO authz.consumed_capabilities (capability_id, expires_at)
    VALUES (p_capability_id, p_expires_at) ON CONFLICT (capability_id) DO NOTHING;
    IF NOT FOUND THEN RAISE EXCEPTION 'authorization capability has already been consumed' USING ERRCODE = '28000'; END IF;
    context_id := extensions.gen_random_uuid();
    INSERT INTO authz.request_contexts (
        context_id, capability_id, backend_pid, transaction_id, actor_id, tenant_id, authz_revision,
        action, resource, issued_at, expires_at
    ) VALUES (
        context_id, p_capability_id, pg_backend_pid(), txid_current(), p_actor_id, p_tenant_id, p_authz_revision,
        p_action, p_resource, p_issued_at, p_expires_at
    ) ON CONFLICT (capability_id) DO NOTHING RETURNING authz.request_contexts.context_id INTO context_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'authorization capability has already been consumed' USING ERRCODE = '28000'; END IF;
    PERFORM set_config('app.authz_context_id', context_id::text, true);
END
$function$;

CREATE OR REPLACE FUNCTION users.current_context_valid_student(
    p_tenant_id uuid, p_student_id uuid, p_required_action text, p_required_resource text
)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, users, authz, app
AS $function$
    SELECT p_tenant_id IS NOT NULL
       AND p_student_id IS NOT NULL
       AND p_required_action IS NOT NULL
       AND p_required_resource IS NOT NULL
       AND EXISTS (
            SELECT 1 FROM authz.request_contexts AS context
            JOIN authz.actor_tenant_authorizations AS grant_row
              ON grant_row.actor_id = context.actor_id
             AND grant_row.authz_revision = context.authz_revision
             AND grant_row.is_authorized
             AND (grant_row.expires_at IS NULL OR grant_row.expires_at > clock_timestamp())
            JOIN authz.principal_authorization_revisions AS revision
              ON revision.actor_id = grant_row.actor_id
             AND revision.authz_revision = grant_row.authz_revision
            WHERE context.context_id = app.current_context_id()
              AND context.backend_pid = pg_backend_pid()
              AND context.transaction_id = txid_current()
              AND context.expires_at > clock_timestamp()
              AND context.tenant_id = p_tenant_id
              AND context.action = p_required_action
              AND context.resource = p_required_resource
              AND (
                    grant_row.grant_kind = 'platform'
                    OR (grant_row.grant_kind = 'tenant' AND grant_row.tenant_id = p_tenant_id)
                    OR (
                        grant_row.grant_kind = 'placement'
                        AND grant_row.tenant_id = p_tenant_id
                        AND EXISTS (
                            SELECT 1 FROM users.student_department_memberships AS membership
                            WHERE membership.student_id = p_student_id
                              AND membership.tenant_id = p_tenant_id
                              AND membership.department_type = 'placement'
                              AND membership.department_id = grant_row.grant_source_id
                              AND membership.status = 'active'
                        )
                    )
              )
       )
$function$;

CREATE FUNCTION users.effective_authz_grants(p_principal_id uuid)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, users
AS $function$
    WITH active_roles AS (
        SELECT assignment.role_name, assignment.scope_kind, assignment.tenant_id,
               assignment.scope_id, assignment.expires_at
        FROM users.role_assignments AS assignment
        WHERE assignment.principal_id = p_principal_id
          AND assignment.status = 'active'
          AND (assignment.expires_at IS NULL OR assignment.expires_at > clock_timestamp())
    ), raw_grants AS (
        SELECT 'platform'::text AS grant_kind,
               '00000000-0000-0000-0000-000000000000'::uuid AS tenant_id,
               '00000000-0000-0000-0000-000000000000'::uuid AS grant_source_id,
               role.expires_at
        FROM active_roles AS role
        WHERE role.scope_kind = 'platform'
        UNION ALL
        SELECT 'tenant'::text, role.tenant_id, role.tenant_id, role.expires_at
        FROM active_roles AS role
        WHERE role.scope_kind IN ('college', 'department', 'batch', 'self')
          AND role.tenant_id IS NOT NULL
        UNION ALL
        SELECT 'placement'::text, student.tenant_id, role.scope_id,
               CASE
                   WHEN role.expires_at IS NULL THEN staff.expires_at
                   WHEN staff.expires_at IS NULL THEN role.expires_at
                   ELSE LEAST(role.expires_at, staff.expires_at)
               END
        FROM active_roles AS role
        JOIN users.placement_department_memberships AS staff
          ON staff.principal_id = p_principal_id
         AND staff.placement_department_id = role.scope_id
         AND staff.status = 'active'
         AND (staff.expires_at IS NULL OR staff.expires_at > clock_timestamp())
        JOIN users.student_department_memberships AS membership
          ON membership.department_id = role.scope_id
         AND membership.department_type = 'placement'
         AND membership.status = 'active'
        JOIN users.students AS student ON student.id = membership.student_id
        WHERE role.scope_kind = 'placement_department'
          AND student.status = 'active'
    ), grouped_grants AS (
        SELECT grant_kind, tenant_id, grant_source_id,
               CASE WHEN bool_or(expires_at IS NULL) THEN NULL ELSE max(expires_at) END AS expires_at
        FROM raw_grants
        GROUP BY grant_kind, tenant_id, grant_source_id
    )
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'grant_kind', grant_kind,
                'tenant_id', tenant_id,
                'grant_source_id', grant_source_id,
                'expires_at', CASE WHEN expires_at IS NULL THEN '' ELSE to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END
            )
            ORDER BY grant_kind, tenant_id, grant_source_id
        ),
        '[]'::jsonb
    )
    FROM grouped_grants
$function$;

CREATE OR REPLACE FUNCTION users.bump_authz_revision(p_principal_id uuid, p_reason text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, users, app, extensions AS $function$
DECLARE
    new_revision bigint;
    snapshot_payload jsonb;
BEGIN
    IF p_principal_id IS NULL OR p_reason !~ '^[a-z][a-z0-9._-]{0,127}$' THEN
        RAISE EXCEPTION 'principal and valid authorization change reason are required';
    END IF;
    INSERT INTO users.authz_revisions AS revision (principal_id, revision, changed_at, change_reason)
    VALUES (p_principal_id, 1, clock_timestamp(), p_reason)
    ON CONFLICT (principal_id) DO UPDATE
    SET revision = revision.revision + 1, changed_at = clock_timestamp(), change_reason = EXCLUDED.change_reason
    RETURNING revision.revision INTO new_revision;
    snapshot_payload := jsonb_build_object(
        'principal_id', p_principal_id,
        'authz_revision', new_revision,
        'reason', p_reason,
        'grants', users.effective_authz_grants(p_principal_id)
    );
    INSERT INTO app.outbox_events (
        event_id, aggregate_type, aggregate_id, event_type, schema_version, payload, payload_sha256
    ) VALUES (
        extensions.gen_random_uuid(), 'principal', p_principal_id,
        'authz.revision_changed.v1', 1,
        jsonb_build_object('principal_id', p_principal_id, 'authz_revision', new_revision, 'reason', p_reason),
        extensions.digest(convert_to(jsonb_build_object('principal_id', p_principal_id, 'authz_revision', new_revision, 'reason', p_reason)::text, 'UTF8'), 'sha256')
    ), (
        extensions.gen_random_uuid(), 'principal', p_principal_id,
        'authz.grants_snapshot.v1', 1, snapshot_payload,
        extensions.digest(convert_to(snapshot_payload::text, 'UTF8'), 'sha256')
    );
    RETURN new_revision;
END
$function$;

REVOKE ALL ON TABLE authz.principal_authorization_revisions, authz.authorization_snapshot_inbox_messages FROM PUBLIC;
REVOKE ALL ON FUNCTION authz.has_platform_authorization_at(uuid, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION authz.apply_authorization_snapshot(uuid, bigint, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION users.effective_authz_grants(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authz.has_platform_authorization_at(uuid, bigint) TO aether_user_app;
GRANT EXECUTE ON FUNCTION authz.apply_authorization_snapshot(uuid, bigint, jsonb) TO aether_user_projection_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON authz.authorization_snapshot_inbox_messages
    TO aether_user_projection_worker;
GRANT SELECT ON authz.principal_authorization_revisions TO aether_user_authz_reader;

RESET ROLE;
