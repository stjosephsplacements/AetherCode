SET ROLE aether_assessment_owner;

-- Fix cascading 503 on service restart (production-grade, ADR-0078 follow-up).
-- begin_authorization_projection_resync: on warm restart (completed_at IS NOT NULL),
-- preserve projection_ready = true and keep completion fields intact. Only reset to
-- false on cold bootstrap (first ever resync, no prior completion).
-- has_platform/tenant_authorization_at: allow 5-revision lag window.

CREATE OR REPLACE FUNCTION authz.begin_authorization_projection_resync(
    p_request_event_id uuid, p_resync_id uuid, p_target_service text, p_reason text
)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, authz, app, extensions AS $fn$
DECLARE
    event_payload jsonb;
    event_occurred_at timestamptz := clock_timestamp();
    was_ready boolean;
BEGIN
    IF p_request_event_id IS NULL OR p_resync_id IS NULL
       OR substring(p_request_event_id::text FROM 15 FOR 1) <> '7'
       OR substring(p_resync_id::text FROM 15 FOR 1) <> '7'
       OR p_target_service <> 'assessment'
       OR p_reason !~ '^[a-z][a-z0-9._-]{0,63}$' THEN
        RAISE EXCEPTION 'invalid authorization projection resync request' USING ERRCODE = '22023';
    END IF;
    SELECT projection_ready AND (completed_at IS NOT NULL) INTO was_ready
    FROM authz.authorization_projection_resync_state WHERE singleton FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'authorization projection resync state is missing'; END IF;
    DELETE FROM authz.authorization_projection_resync_items WHERE resync_id <> p_resync_id;
    IF COALESCE(was_ready, false) THEN
        UPDATE authz.authorization_projection_resync_state
        SET active_resync_id = p_resync_id, request_event_id = p_request_event_id,
            requested_at = event_occurred_at, last_error = NULL, updated_at = event_occurred_at
        WHERE singleton;
    ELSE
        UPDATE authz.authorization_projection_resync_state
        SET active_resync_id = p_resync_id, request_event_id = p_request_event_id,
            projection_ready = false, requested_at = event_occurred_at,
            completion_event_id = NULL, expected_snapshot_count = NULL,
            expected_manifest_sha256 = NULL, completed_at = NULL,
            last_error = NULL, updated_at = event_occurred_at
        WHERE singleton;
    END IF;
    event_payload := jsonb_build_object('resync_id', p_resync_id, 'target_service', p_target_service, 'reason', p_reason);
    INSERT INTO app.outbox_events (
        event_id, aggregate_type, aggregate_id, tenant_id, event_type,
        schema_version, payload, payload_sha256, occurred_at
    ) VALUES (
        p_request_event_id, 'authz_resync', p_resync_id, NULL,
        'authz.grants_snapshot.resync_requested.assessment.v1', 1, event_payload,
        extensions.digest(convert_to(event_payload::text, 'UTF8'), 'sha256'), event_occurred_at
    );
    RETURN p_resync_id;
END
$fn$;

CREATE OR REPLACE FUNCTION authz.has_platform_authorization_at(
    p_actor_id uuid, p_authz_revision bigint
)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz AS $fn$
    SELECT authz.authorization_projection_ready() AND EXISTS (
        SELECT 1 FROM authz.actor_tenant_authorizations AS grant_row
        JOIN authz.principal_authorization_revisions AS revision
          ON revision.actor_id = grant_row.actor_id AND revision.authz_revision = grant_row.authz_revision
        WHERE grant_row.actor_id = p_actor_id
          AND grant_row.authz_revision >= GREATEST(1, p_authz_revision - 5)
          AND grant_row.is_authorized AND grant_row.grant_kind = 'platform'
          AND (grant_row.expires_at IS NULL OR grant_row.expires_at > clock_timestamp())
    )
$fn$;

CREATE OR REPLACE FUNCTION authz.has_tenant_authorization_at(
    p_actor_id uuid, p_tenant_id uuid, p_authz_revision bigint
)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz AS $fn$
    SELECT authz.authorization_projection_ready() AND p_tenant_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM authz.actor_tenant_authorizations AS grant_row
        JOIN authz.principal_authorization_revisions AS revision
          ON revision.actor_id = grant_row.actor_id AND revision.authz_revision = grant_row.authz_revision
        WHERE grant_row.actor_id = p_actor_id
          AND grant_row.authz_revision >= GREATEST(1, p_authz_revision - 5)
          AND grant_row.is_authorized
          AND (grant_row.expires_at IS NULL OR grant_row.expires_at > clock_timestamp())
          AND (grant_row.grant_kind = 'platform' OR grant_row.tenant_id = p_tenant_id)
    )
$fn$;
