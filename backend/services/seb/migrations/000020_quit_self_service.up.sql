-- Quit-token self-service (ADR-0022 follow-up): lockdown sessions, safe redemption
-- after the attempt ends, and closing issued sessions on submit.
SET ROLE aether_seb_owner;

ALTER TABLE seb.sessions
    ADD COLUMN IF NOT EXISTS quit_redeemed_at timestamptz,
    ADD CONSTRAINT sessions_quit_redeemed_check
        CHECK (quit_redeemed_at IS NULL OR quit_redeemed_at >= issued_at);

CREATE OR REPLACE FUNCTION seb.close_sessions_for_attempt(
    p_event_id uuid,
    p_tenant_id uuid,
    p_attempt_id uuid,
    p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, seb
AS $function$
BEGIN
    IF p_event_id IS NULL OR p_tenant_id IS NULL OR p_attempt_id IS NULL
       OR p_reason IS NULL OR length(p_reason) = 0 THEN
        RAISE EXCEPTION 'invalid session close parameters' USING ERRCODE = '22023';
    END IF;

    UPDATE seb.sessions
    SET lifecycle_state = 'closed',
        closed_at = clock_timestamp(),
        closed_reason = p_reason,
        version = version + 1
    WHERE tenant_id = p_tenant_id
      AND attempt_id = p_attempt_id
      AND lifecycle_state IN ('issued', 'active');
END
$function$;

CREATE OR REPLACE FUNCTION seb.ensure_lockdown_configuration(
    p_tenant_id uuid,
    p_exam_id uuid,
    p_exam_version_id uuid,
    p_actor_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, seb, authz, extensions
AS $function$
DECLARE
    config_id uuid;
    zero_hash char(64) := repeat('0', 64);
BEGIN
    IF p_tenant_id IS NULL OR p_exam_id IS NULL OR p_exam_version_id IS NULL OR p_actor_id IS NULL THEN
        RAISE EXCEPTION 'invalid lockdown configuration parameters' USING ERRCODE = '22023';
    END IF;
    IF NOT authz.current_context_allows(p_tenant_id, 'seb.write', 'seb.configurations') THEN
        RAISE EXCEPTION 'current authorization context cannot manage lockdown configurations'
            USING ERRCODE = '42501';
    END IF;

    SELECT id INTO config_id
    FROM seb.configurations
    WHERE tenant_id = p_tenant_id
      AND exam_id = p_exam_id
      AND exam_version_id = p_exam_version_id
      AND lifecycle_state = 'active'
    LIMIT 1;
    IF FOUND THEN
        RETURN config_id;
    END IF;

    config_id := extensions.gen_random_uuid();
    INSERT INTO seb.configurations (
        id, tenant_id, exam_id, exam_version_id, configuration_version,
        config_object_key, config_checksum, encryption_key_reference,
        config_key_hash, browser_exam_key_hash, lifecycle_state, created_by
    ) VALUES (
        config_id, p_tenant_id, p_exam_id, p_exam_version_id, 1,
        'lockdown/' || p_exam_id::text, zero_hash, 'none',
        zero_hash, NULL, 'active', p_actor_id
    );
    RETURN config_id;
END
$function$;

CREATE FUNCTION seb.issue_lockdown_quit_session(
    p_session_id uuid,
    p_event_id uuid,
    p_tenant_id uuid,
    p_attempt_id uuid,
    p_exam_id uuid,
    p_exam_version_id uuid,
    p_expires_at timestamptz,
    p_quit_token_hash char(64)
)
RETURNS TABLE (
    id uuid,
    tenant_id uuid,
    configuration_id uuid,
    attempt_id uuid,
    candidate_id uuid,
    lifecycle_state text,
    issued_at timestamptz,
    activated_at timestamptz,
    closed_at timestamptz,
    expires_at timestamptz,
    closed_reason text,
    version bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, seb, authz, app, extensions
AS $function$
DECLARE
    actor_id uuid;
    configuration_id uuid;
    session_row seb.sessions%ROWTYPE;
    event_payload jsonb;
BEGIN
    IF p_session_id IS NULL OR p_event_id IS NULL OR p_tenant_id IS NULL OR p_attempt_id IS NULL
       OR p_exam_id IS NULL OR p_exam_version_id IS NULL OR p_quit_token_hash IS NULL OR p_expires_at IS NULL
       OR p_expires_at <= clock_timestamp()
       OR p_expires_at > clock_timestamp() + interval '24 hours' THEN
        RAISE EXCEPTION 'invalid lockdown quit session issuance' USING ERRCODE = '22023';
    END IF;
    actor_id := authz.current_actor_id();
    IF actor_id IS NULL THEN
        RAISE EXCEPTION 'missing authorization actor' USING ERRCODE = '42501';
    END IF;
    IF NOT authz.current_context_allows(p_tenant_id, 'seb.write', 'seb.sessions') THEN
        RAISE EXCEPTION 'current authorization context cannot issue a lockdown quit session'
            USING ERRCODE = '42501';
    END IF;

    IF EXISTS (
        SELECT 1 FROM seb.sessions
        WHERE tenant_id = p_tenant_id AND attempt_id = p_attempt_id
    ) THEN
        RAISE EXCEPTION 'an SEB quit session already exists for this attempt'
            USING ERRCODE = '23505';
    END IF;

    configuration_id := seb.ensure_lockdown_configuration(
        p_tenant_id, p_exam_id, p_exam_version_id, actor_id
    );

    INSERT INTO seb.sessions (
        id, tenant_id, configuration_id, attempt_id, candidate_id,
        quit_token_hash, expires_at
    ) VALUES (
        p_session_id, p_tenant_id, configuration_id, p_attempt_id, actor_id,
        p_quit_token_hash, p_expires_at
    ) RETURNING * INTO session_row;

    event_payload := jsonb_build_object(
        'session_id', session_row.id,
        'tenant_id', session_row.tenant_id,
        'configuration_id', session_row.configuration_id,
        'attempt_id', session_row.attempt_id,
        'candidate_id', session_row.candidate_id,
        'expires_at', session_row.expires_at
    );
    INSERT INTO app.outbox_events (
        event_id, aggregate_type, aggregate_id, tenant_id, event_type,
        schema_version, payload, payload_sha256, occurred_at, next_attempt_at
    ) VALUES (
        p_event_id, 'seb_session', session_row.id, p_tenant_id,
        'seb.session.issued.v1', 1, event_payload,
        extensions.digest(convert_to(event_payload::text, 'UTF8'), 'sha256'),
        clock_timestamp(), clock_timestamp()
    );

    RETURN QUERY
    SELECT session_row.id, session_row.tenant_id, session_row.configuration_id,
           session_row.attempt_id, session_row.candidate_id,
           session_row.lifecycle_state, session_row.issued_at,
           session_row.activated_at, session_row.closed_at,
           session_row.expires_at, session_row.closed_reason,
           session_row.version;
END
$function$;

CREATE FUNCTION seb.redeem_quit_token(p_quit_token_hash char(64))
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, seb, authz
AS $function$
DECLARE
    actor_id uuid;
    session_row seb.sessions%ROWTYPE;
BEGIN
    IF p_quit_token_hash IS NULL OR p_quit_token_hash !~* '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'invalid quit token hash' USING ERRCODE = '22023';
    END IF;
    actor_id := authz.current_actor_id();
    IF actor_id IS NULL THEN
        RAISE EXCEPTION 'missing authorization actor' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO session_row
    FROM seb.sessions
    WHERE quit_token_hash = p_quit_token_hash
      AND candidate_id = actor_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'quit token redemption denied' USING ERRCODE = '42501';
    END IF;
    IF NOT authz.current_context_allows(session_row.tenant_id, 'seb.read', 'seb.sessions') THEN
        RAISE EXCEPTION 'quit token redemption denied' USING ERRCODE = '42501';
    END IF;

    IF session_row.quit_redeemed_at IS NOT NULL THEN
        RAISE EXCEPTION 'quit token already redeemed' USING ERRCODE = '23505';
    END IF;

    IF session_row.lifecycle_state <> 'closed'
       OR session_row.closed_reason IS NULL
       OR session_row.closed_reason NOT IN ('submitted', 'expired', 'revoked', 'cancelled') THEN
        RAISE EXCEPTION 'quit token is not yet available for self-service' USING ERRCODE = '42501';
    END IF;

    UPDATE seb.sessions
    SET quit_redeemed_at = clock_timestamp(),
        version = version + 1
    WHERE id = session_row.id;
END
$function$;

REVOKE ALL ON FUNCTION seb.ensure_lockdown_configuration(uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION seb.issue_lockdown_quit_session(uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, char(64)) FROM PUBLIC;
REVOKE ALL ON FUNCTION seb.redeem_quit_token(char(64)) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION seb.ensure_lockdown_configuration(uuid, uuid, uuid, uuid) TO aether_seb_app;
GRANT EXECUTE ON FUNCTION seb.issue_lockdown_quit_session(uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, char(64)) TO aether_seb_app;
GRANT EXECUTE ON FUNCTION seb.redeem_quit_token(char(64)) TO aether_seb_app;

RESET ROLE;