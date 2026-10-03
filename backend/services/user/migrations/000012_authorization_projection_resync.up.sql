-- A JetStream durable can be offline longer than the eight-day stream
-- retention window. A local grant projection must therefore treat startup or
-- consumer recovery as unknown until the User authority has supplied a fresh,
-- complete, manifest-verified batch. The request is written to the target's
-- normal outbox by a narrow projection-worker function; no application role
-- receives direct access to the resync state or canonical authorization data.
SET ROLE aether_user_owner;

CREATE TABLE authz.authorization_projection_resync_state (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    active_resync_id uuid,
    request_event_id uuid,
    projection_ready boolean NOT NULL DEFAULT false,
    requested_at timestamptz,
    completion_event_id uuid,
    expected_snapshot_count integer,
    expected_manifest_sha256 bytea,
    completed_at timestamptz,
    last_error text,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (
        (completion_event_id IS NULL AND expected_snapshot_count IS NULL AND expected_manifest_sha256 IS NULL)
        OR (
            completion_event_id IS NOT NULL
            AND expected_snapshot_count BETWEEN 0 AND 100000
            AND octet_length(expected_manifest_sha256) = 32
        )
    ),
    CHECK (
        NOT projection_ready
        OR (
            active_resync_id IS NOT NULL
            AND completion_event_id IS NOT NULL
            AND expected_snapshot_count IS NOT NULL
            AND expected_manifest_sha256 IS NOT NULL
        )
    )
);
INSERT INTO authz.authorization_projection_resync_state (singleton)
VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE authz.authorization_projection_resync_items (
    resync_id uuid NOT NULL,
    principal_id uuid NOT NULL,
    authz_revision bigint NOT NULL CHECK (authz_revision > 0),
    snapshot_sha256 bytea NOT NULL CHECK (octet_length(snapshot_sha256) = 32),
    source_event_id uuid NOT NULL UNIQUE,
    received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (resync_id, principal_id)
);
CREATE INDEX authorization_projection_resync_items_received_idx
    ON authz.authorization_projection_resync_items (resync_id, received_at);

-- The server-side allow-list is intentionally an enum-like relation rather
-- than request-controlled text. New RLS-protected services require an
-- explicit migration addition and a matching NATS ACL entry.
CREATE TABLE users.authorization_resync_service_targets (
    target_service text PRIMARY KEY
        CHECK (target_service IN (
            'tenant', 'user', 'question-bank', 'assessment', 'submission',
            'seb', 'notification', 'analytics'
        )),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO users.authorization_resync_service_targets (target_service)
VALUES
    ('tenant'), ('user'), ('question-bank'), ('assessment'), ('submission'),
    ('seb'), ('notification'), ('analytics')
ON CONFLICT DO NOTHING;

CREATE TABLE users.authorization_resync_target_limits (
    target_service text PRIMARY KEY REFERENCES users.authorization_resync_service_targets (target_service)
        ON DELETE RESTRICT,
    last_accepted_at timestamptz,
    last_resync_id uuid,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- This table doubles as the canonical request inbox. The two unique IDs and
-- immutable payload hash make broker replay harmless without keeping an
-- unbounded JetStream-derived inbox forever.
CREATE TABLE users.authorization_resync_requests (
    resync_id uuid PRIMARY KEY,
    request_event_id uuid NOT NULL UNIQUE,
    target_service text NOT NULL REFERENCES users.authorization_resync_service_targets (target_service)
        ON DELETE RESTRICT,
    reason text NOT NULL CHECK (reason ~ '^[a-z][a-z0-9._-]{0,63}$'),
    request_payload_sha256 bytea NOT NULL CHECK (octet_length(request_payload_sha256) = 32),
    request_occurred_at timestamptz NOT NULL,
    accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    snapshot_count integer NOT NULL CHECK (snapshot_count BETWEEN 0 AND 100000),
    manifest_sha256 bytea NOT NULL CHECK (octet_length(manifest_sha256) = 32),
    response_created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX authorization_resync_requests_retention_idx
    ON users.authorization_resync_requests (accepted_at);

CREATE FUNCTION authz.authorization_projection_ready()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, authz
AS $function$
    SELECT COALESCE((
        SELECT state.projection_ready
        FROM authz.authorization_projection_resync_state AS state
        WHERE state.singleton = true
    ), false)
$function$;

-- Gate both context-verification helpers. authz.set_context already calls
-- these functions, so a restarted/partitioned projection cannot mint a new
-- local RLS context even if an old principal revision happens to match.
CREATE OR REPLACE FUNCTION authz.has_platform_authorization_at(
    p_actor_id uuid, p_authz_revision bigint
)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, authz
AS $function$
    SELECT authz.authorization_projection_ready()
       AND EXISTS (
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
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, authz
AS $function$
    SELECT authz.authorization_projection_ready()
       AND p_tenant_id IS NOT NULL
       AND EXISTS (
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

-- This function is called only by the User projection worker through the
-- shared authzprojection.ResyncStore. It takes application-generated UUIDv7
-- IDs, clears old response bookkeeping under one state-row lock, makes the
-- local projection fail closed, and atomically enqueues the request event.
CREATE FUNCTION authz.begin_authorization_projection_resync(
    p_request_event_id uuid,
    p_resync_id uuid,
    p_target_service text,
    p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz, app, extensions
AS $function$
DECLARE
    event_payload jsonb;
    event_occurred_at timestamptz := clock_timestamp();
BEGIN
    IF p_request_event_id IS NULL
       OR p_resync_id IS NULL
       OR substring(p_request_event_id::text FROM 15 FOR 1) <> '7'
       OR substring(p_resync_id::text FROM 15 FOR 1) <> '7'
       OR p_target_service <> 'user'
       OR p_reason !~ '^[a-z][a-z0-9._-]{0,63}$'
    THEN
        RAISE EXCEPTION 'invalid authorization projection resync request' USING ERRCODE = '22023';
    END IF;

    PERFORM 1
    FROM authz.authorization_projection_resync_state
    WHERE singleton = true
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'authorization projection resync state is missing';
    END IF;

    DELETE FROM authz.authorization_projection_resync_items
    WHERE resync_id <> p_resync_id;

    UPDATE authz.authorization_projection_resync_state
    SET active_resync_id = p_resync_id,
        request_event_id = p_request_event_id,
        projection_ready = false,
        requested_at = event_occurred_at,
        completion_event_id = NULL,
        expected_snapshot_count = NULL,
        expected_manifest_sha256 = NULL,
        completed_at = NULL,
        last_error = NULL,
        updated_at = event_occurred_at
    WHERE singleton = true;

    event_payload := jsonb_build_object(
        'resync_id', p_resync_id,
        'target_service', p_target_service,
        'reason', p_reason
    );
    INSERT INTO app.outbox_events (
        event_id, aggregate_type, aggregate_id, event_type,
        schema_version, payload, payload_sha256, occurred_at
    ) VALUES (
        p_request_event_id,
        'authz_resync',
        p_resync_id,
        'authz.grants_snapshot.resync_requested.user.v1',
        1,
        event_payload,
        extensions.digest(convert_to(event_payload::text, 'UTF8'), 'sha256'),
        event_occurred_at
    );
    RETURN p_resync_id;
END
$function$;

-- The canonical authority calls this only after Go has strictly validated the
-- event envelope, dynamic subject, UUIDv7 resync ID, and payload. It remains
-- a SECURITY DEFINER boundary so the worker cannot read role assignments,
-- policy data, or write arbitrary rows to the User outbox.
CREATE FUNCTION users.process_authorization_resync_request(
    p_request_event_id uuid,
    p_request_payload_sha256 bytea,
    p_request_occurred_at timestamptz,
    p_resync_id uuid,
    p_target_service text,
    p_reason text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, users, app, extensions
AS $function$
DECLARE
    existing_request users.authorization_resync_requests%ROWTYPE;
    latest_request users.authorization_resync_target_limits%ROWTYPE;
    current_timestamp_value timestamptz := clock_timestamp();
    emitted_count integer;
BEGIN
    IF p_request_event_id IS NULL
       OR p_resync_id IS NULL
       OR p_request_payload_sha256 IS NULL
       OR octet_length(p_request_payload_sha256) <> 32
       OR p_request_occurred_at IS NULL
       OR substring(p_request_event_id::text FROM 15 FOR 1) <> '7'
       OR substring(p_resync_id::text FROM 15 FOR 1) <> '7'
       OR p_target_service !~ '^[a-z][a-z0-9-]{0,62}$'
       OR p_reason !~ '^[a-z][a-z0-9._-]{0,63}$'
    THEN
        RAISE EXCEPTION 'invalid authorization resync request' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO existing_request
    FROM users.authorization_resync_requests
    WHERE resync_id = p_resync_id
    FOR KEY SHARE;
    IF FOUND THEN
        IF existing_request.request_event_id <> p_request_event_id
           OR existing_request.target_service <> p_target_service
           OR existing_request.reason <> p_reason
           OR existing_request.request_payload_sha256 <> p_request_payload_sha256
        THEN
            RAISE EXCEPTION 'authorization resync ID was replayed with different content' USING ERRCODE = '22023';
        END IF;
        RETURN true;
    END IF;

    SELECT * INTO existing_request
    FROM users.authorization_resync_requests
    WHERE request_event_id = p_request_event_id
    FOR KEY SHARE;
    IF FOUND THEN
        RAISE EXCEPTION 'authorization resync event ID was replayed with different content' USING ERRCODE = '22023';
    END IF;

    PERFORM 1
    FROM users.authorization_resync_service_targets
    WHERE target_service = p_target_service;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'authorization resync target service is not permitted' USING ERRCODE = '22023';
    END IF;

    INSERT INTO users.authorization_resync_target_limits (target_service)
    VALUES (p_target_service)
    ON CONFLICT (target_service) DO NOTHING;
    SELECT * INTO latest_request
    FROM users.authorization_resync_target_limits
    WHERE target_service = p_target_service
    FOR UPDATE;
    IF latest_request.last_accepted_at IS NOT NULL
       AND latest_request.last_accepted_at > current_timestamp_value - interval '30 seconds'
    THEN
        RAISE EXCEPTION 'authorization resync request rate limited' USING ERRCODE = 'P0001';
    END IF;

    WITH snapshots AS MATERIALIZED (
        SELECT revision.principal_id,
               revision.revision AS authz_revision,
               jsonb_build_object(
                   'principal_id', revision.principal_id,
                   'authz_revision', revision.revision,
                   'reason', revision.change_reason,
                   'grants', users.effective_authz_grants(revision.principal_id)
               ) AS snapshot_payload
        FROM users.authz_revisions AS revision
        ORDER BY revision.principal_id
    ), entries AS MATERIALIZED (
        SELECT principal_id,
               authz_revision,
               snapshot_payload,
               encode(
                   extensions.digest(convert_to(snapshot_payload::text, 'UTF8'), 'sha256'),
                   'hex'
               ) AS snapshot_sha256
        FROM snapshots
    ), batch_manifest AS MATERIALIZED (
        SELECT count(*)::integer AS snapshot_count,
               encode(
                   extensions.digest(
                       convert_to(
                           COALESCE(
                               string_agg(
                                   principal_id::text || '|' || authz_revision::text || '|' || snapshot_sha256,
                                   E'\n' ORDER BY principal_id
                               ),
                               ''
                           ),
                           'UTF8'
                       ),
                       'sha256'
                   ),
                   'hex'
               ) AS manifest_sha256
        FROM entries
    ), permitted_batch AS MATERIALIZED (
        SELECT * FROM batch_manifest WHERE snapshot_count <= 100000
    ), snapshot_payloads AS MATERIALIZED (
        SELECT jsonb_build_object(
                   'resync_id', p_resync_id,
                   'target_service', p_target_service,
                   'snapshot', entry.snapshot_payload,
                   'snapshot_sha256', entry.snapshot_sha256
               ) AS payload
        FROM entries AS entry
        CROSS JOIN permitted_batch
    ), snapshot_outbox AS (
        INSERT INTO app.outbox_events (
            event_id, aggregate_type, aggregate_id, event_type,
            schema_version, payload, payload_sha256, occurred_at
        )
        SELECT uuidv7(),
               'authz_resync',
               p_resync_id,
               'authz.grants_snapshot.resync_snapshot.' || p_target_service || '.v1',
               1,
               payload,
               extensions.digest(convert_to(payload::text, 'UTF8'), 'sha256'),
               current_timestamp_value
        FROM snapshot_payloads
    ), completion_payload AS MATERIALIZED (
        SELECT jsonb_build_object(
                   'resync_id', p_resync_id,
                   'target_service', p_target_service,
                   'snapshot_count', snapshot_count,
                   'manifest_sha256', manifest_sha256
               ) AS payload
        FROM permitted_batch
    ), completion_outbox AS (
        INSERT INTO app.outbox_events (
            event_id, aggregate_type, aggregate_id, event_type,
            schema_version, payload, payload_sha256, occurred_at
        )
        SELECT uuidv7(),
               'authz_resync',
               p_resync_id,
               'authz.grants_snapshot.resync_completed.' || p_target_service || '.v1',
               1,
               payload,
               extensions.digest(convert_to(payload::text, 'UTF8'), 'sha256'),
               current_timestamp_value
        FROM completion_payload
    )
    INSERT INTO users.authorization_resync_requests (
        resync_id, request_event_id, target_service, reason,
        request_payload_sha256, request_occurred_at, accepted_at,
        snapshot_count, manifest_sha256, response_created_at
    )
    SELECT p_resync_id,
           p_request_event_id,
           p_target_service,
           p_reason,
           p_request_payload_sha256,
           p_request_occurred_at,
           current_timestamp_value,
           snapshot_count,
           decode(manifest_sha256, 'hex'),
           current_timestamp_value
    FROM permitted_batch
    RETURNING snapshot_count INTO emitted_count;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'authorization resync batch exceeds the 100000-principal safety limit'
            USING ERRCODE = 'P0001';
    END IF;

    UPDATE users.authorization_resync_target_limits
    SET last_accepted_at = current_timestamp_value,
        last_resync_id = p_resync_id,
        updated_at = current_timestamp_value
    WHERE target_service = p_target_service;

    -- Retain enough history to deduplicate delayed broker replay while keeping
    -- this control-plane inbox bounded without an application-table grant.
    WITH expired AS (
        SELECT resync_id
        FROM users.authorization_resync_requests
        WHERE accepted_at < current_timestamp_value - interval '30 days'
        ORDER BY accepted_at
        LIMIT 1000
        FOR UPDATE SKIP LOCKED
    )
    DELETE FROM users.authorization_resync_requests AS request_row
    USING expired
    WHERE request_row.resync_id = expired.resync_id;

    RETURN emitted_count >= 0;
END
$function$;

REVOKE ALL ON TABLE authz.authorization_projection_resync_state,
    authz.authorization_projection_resync_items,
    users.authorization_resync_service_targets,
    users.authorization_resync_target_limits,
    users.authorization_resync_requests
    FROM PUBLIC;
REVOKE ALL ON FUNCTION authz.authorization_projection_ready() FROM PUBLIC;
REVOKE ALL ON FUNCTION authz.begin_authorization_projection_resync(uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION users.process_authorization_resync_request(
    uuid, bytea, timestamptz, uuid, text, text
) FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON authz.authorization_projection_resync_state,
    authz.authorization_projection_resync_items
    TO aether_user_projection_worker;
-- USAGE names the narrowly granted projection tables/functions; it conveys no
-- table privilege and is required for the worker to invoke the qualified
-- users.process_authorization_resync_request SECURITY DEFINER entry point.
GRANT USAGE ON SCHEMA users TO aether_user_projection_worker;
GRANT EXECUTE ON FUNCTION authz.begin_authorization_projection_resync(uuid, uuid, text, text)
    TO aether_user_projection_worker;
GRANT EXECUTE ON FUNCTION users.process_authorization_resync_request(
    uuid, bytea, timestamptz, uuid, text, text
) TO aether_user_projection_worker;

RESET ROLE;
