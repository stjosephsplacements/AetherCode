-- Multi-table SEB workflows run through narrow security-definer procedures.
-- Each procedure re-checks the signed, transaction-bound RLS capability before
-- reading or changing any related table, so the app role never needs broad
-- cross-resource grants.
SET ROLE aether_seb_owner;

CREATE FUNCTION seb.rotate_configuration(
    p_previous_configuration_id uuid,
    p_replacement_configuration_id uuid,
    p_rotation_id uuid,
    p_event_id uuid,
    p_tenant_id uuid,
    p_exam_id uuid,
    p_exam_version_id uuid,
    p_configuration_version integer,
    p_config_object_key text,
    p_config_checksum char(64),
    p_browser_exam_key_hash char(64),
    p_encryption_key_reference text,
    p_config_key_hash char(64),
    p_reason text,
    p_rotated_by uuid
)
RETURNS TABLE (
    id uuid,
    tenant_id uuid,
    exam_id uuid,
    exam_version_id uuid,
    configuration_version integer,
    config_object_key text,
    config_checksum char(64),
    encryption_key_reference text,
    lifecycle_state text,
    created_by uuid,
    created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, seb, authz, app, extensions
AS $function$
DECLARE
    previous_configuration seb.configurations%ROWTYPE;
    replacement_configuration seb.configurations%ROWTYPE;
    event_payload jsonb;
BEGIN
    IF p_previous_configuration_id IS NULL OR p_replacement_configuration_id IS NULL
       OR p_rotation_id IS NULL OR p_event_id IS NULL OR p_tenant_id IS NULL
       OR p_exam_id IS NULL OR p_exam_version_id IS NULL OR p_rotated_by IS NULL
       OR p_previous_configuration_id = p_replacement_configuration_id
       OR p_configuration_version < 1
       OR length(btrim(p_config_object_key)) = 0
       OR length(btrim(p_encryption_key_reference)) = 0
       OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN
        RAISE EXCEPTION 'invalid SEB configuration rotation' USING ERRCODE = '22023';
    END IF;
    IF NOT authz.current_context_allows(p_tenant_id, 'seb.write', 'seb.configurations') THEN
        RAISE EXCEPTION 'current authorization context cannot rotate an SEB configuration'
            USING ERRCODE = '42501';
    END IF;

    SELECT * INTO previous_configuration
    FROM seb.configurations
    WHERE id = p_previous_configuration_id AND tenant_id = p_tenant_id
    FOR UPDATE;
    IF NOT FOUND OR previous_configuration.lifecycle_state <> 'active'
       OR previous_configuration.exam_id <> p_exam_id
       OR previous_configuration.exam_version_id <> p_exam_version_id
       OR p_configuration_version <> previous_configuration.configuration_version + 1 THEN
        RETURN;
    END IF;

    UPDATE seb.configurations
    SET lifecycle_state = 'retired', retired_at = clock_timestamp()
    WHERE id = previous_configuration.id AND tenant_id = p_tenant_id
      AND lifecycle_state = 'active';
    IF NOT FOUND THEN
        RETURN;
    END IF;

    INSERT INTO seb.configurations (
        id, tenant_id, exam_id, exam_version_id, configuration_version,
        config_object_key, config_checksum, encryption_key_reference,
        config_key_hash, browser_exam_key_hash, created_by
    ) VALUES (
        p_replacement_configuration_id, p_tenant_id, p_exam_id, p_exam_version_id,
        p_configuration_version, p_config_object_key, p_config_checksum,
        p_encryption_key_reference, p_config_key_hash, p_browser_exam_key_hash,
        p_rotated_by
    ) RETURNING * INTO replacement_configuration;

    INSERT INTO seb.key_rotations (
        id, tenant_id, previous_configuration_id, replacement_configuration_id,
        reason, rotated_by
    ) VALUES (
        p_rotation_id, p_tenant_id, previous_configuration.id,
        replacement_configuration.id, p_reason, p_rotated_by
    );

    event_payload := jsonb_build_object(
        'previous_configuration_id', previous_configuration.id,
        'replacement_configuration_id', replacement_configuration.id,
        'tenant_id', p_tenant_id,
        'exam_id', p_exam_id,
        'exam_version_id', p_exam_version_id,
        'configuration_version', p_configuration_version
    );
    INSERT INTO app.outbox_events (
        event_id, aggregate_type, aggregate_id, tenant_id, event_type,
        schema_version, payload, payload_sha256, occurred_at, next_attempt_at
    ) VALUES (
        p_event_id, 'seb_configuration', replacement_configuration.id, p_tenant_id,
        'seb.configuration.rotated.v1', 1, event_payload,
        extensions.digest(convert_to(event_payload::text, 'UTF8'), 'sha256'),
        clock_timestamp(), clock_timestamp()
    );

    RETURN QUERY
    SELECT replacement_configuration.id, replacement_configuration.tenant_id,
           replacement_configuration.exam_id, replacement_configuration.exam_version_id,
           replacement_configuration.configuration_version,
           replacement_configuration.config_object_key,
           replacement_configuration.config_checksum,
           replacement_configuration.encryption_key_reference,
           replacement_configuration.lifecycle_state,
           replacement_configuration.created_by, replacement_configuration.created_at;
END
$function$;

CREATE FUNCTION seb.revoke_configuration(
    p_configuration_id uuid,
    p_event_id uuid,
    p_tenant_id uuid,
    p_reason text,
    p_revoked_by uuid
)
RETURNS TABLE (
    id uuid,
    tenant_id uuid,
    exam_id uuid,
    exam_version_id uuid,
    configuration_version integer,
    config_object_key text,
    config_checksum char(64),
    encryption_key_reference text,
    lifecycle_state text,
    created_by uuid,
    created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, seb, authz, app, extensions
AS $function$
DECLARE
    configuration_record seb.configurations%ROWTYPE;
    event_payload jsonb;
BEGIN
    IF p_configuration_id IS NULL OR p_event_id IS NULL OR p_tenant_id IS NULL
       OR p_revoked_by IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN
        RAISE EXCEPTION 'invalid SEB configuration revocation' USING ERRCODE = '22023';
    END IF;
    IF NOT authz.current_context_allows(p_tenant_id, 'seb.write', 'seb.configurations') THEN
        RAISE EXCEPTION 'current authorization context cannot revoke an SEB configuration'
            USING ERRCODE = '42501';
    END IF;
    UPDATE seb.configurations
    SET lifecycle_state = 'revoked', revoked_at = clock_timestamp()
    WHERE id = p_configuration_id AND tenant_id = p_tenant_id
      AND lifecycle_state = 'active'
    RETURNING * INTO configuration_record;
    IF NOT FOUND THEN
        RETURN;
    END IF;
    event_payload := jsonb_build_object(
        'configuration_id', configuration_record.id,
        'tenant_id', configuration_record.tenant_id,
        'exam_id', configuration_record.exam_id,
        'exam_version_id', configuration_record.exam_version_id,
        'reason', p_reason,
        'revoked_by', p_revoked_by
    );
    INSERT INTO app.outbox_events (
        event_id, aggregate_type, aggregate_id, tenant_id, event_type,
        schema_version, payload, payload_sha256, occurred_at, next_attempt_at
    ) VALUES (
        p_event_id, 'seb_configuration', configuration_record.id, p_tenant_id,
        'seb.configuration.revoked.v1', 1, event_payload,
        extensions.digest(convert_to(event_payload::text, 'UTF8'), 'sha256'),
        clock_timestamp(), clock_timestamp()
    );
    RETURN QUERY
    SELECT configuration_record.id, configuration_record.tenant_id,
           configuration_record.exam_id, configuration_record.exam_version_id,
           configuration_record.configuration_version,
           configuration_record.config_object_key, configuration_record.config_checksum,
           configuration_record.encryption_key_reference,
           configuration_record.lifecycle_state, configuration_record.created_by,
           configuration_record.created_at;
END
$function$;

CREATE FUNCTION seb.issue_session(
    p_session_id uuid,
    p_event_id uuid,
    p_tenant_id uuid,
    p_configuration_id uuid,
    p_attempt_id uuid,
    p_candidate_id uuid,
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
    configuration_record seb.configurations%ROWTYPE;
    session_record seb.sessions%ROWTYPE;
    event_payload jsonb;
BEGIN
    IF p_session_id IS NULL OR p_event_id IS NULL OR p_tenant_id IS NULL
       OR p_configuration_id IS NULL OR p_attempt_id IS NULL OR p_candidate_id IS NULL
       OR p_quit_token_hash IS NULL OR p_expires_at IS NULL
       OR p_expires_at <= clock_timestamp()
       OR p_expires_at > clock_timestamp() + interval '24 hours' THEN
        RAISE EXCEPTION 'invalid SEB session issuance' USING ERRCODE = '22023';
    END IF;
    IF NOT authz.current_context_allows(p_tenant_id, 'seb.write', 'seb.sessions') THEN
        RAISE EXCEPTION 'current authorization context cannot issue an SEB session'
            USING ERRCODE = '42501';
    END IF;
    SELECT * INTO configuration_record
    FROM seb.configurations
    WHERE id = p_configuration_id AND tenant_id = p_tenant_id
      AND lifecycle_state = 'active'
    FOR SHARE;
    IF NOT FOUND THEN
        RETURN;
    END IF;
    INSERT INTO seb.sessions (
        id, tenant_id, configuration_id, attempt_id, candidate_id,
        quit_token_hash, expires_at
    ) VALUES (
        p_session_id, p_tenant_id, p_configuration_id, p_attempt_id, p_candidate_id,
        p_quit_token_hash, p_expires_at
    ) RETURNING * INTO session_record;
    event_payload := jsonb_build_object(
        'session_id', session_record.id,
        'tenant_id', session_record.tenant_id,
        'configuration_id', session_record.configuration_id,
        'attempt_id', session_record.attempt_id,
        'candidate_id', session_record.candidate_id,
        'expires_at', session_record.expires_at
    );
    INSERT INTO app.outbox_events (
        event_id, aggregate_type, aggregate_id, tenant_id, event_type,
        schema_version, payload, payload_sha256, occurred_at, next_attempt_at
    ) VALUES (
        p_event_id, 'seb_session', session_record.id, p_tenant_id,
        'seb.session.issued.v1', 1, event_payload,
        extensions.digest(convert_to(event_payload::text, 'UTF8'), 'sha256'),
        clock_timestamp(), clock_timestamp()
    );
    RETURN QUERY
    SELECT session_record.id, session_record.tenant_id, session_record.configuration_id,
           session_record.attempt_id, session_record.candidate_id,
           session_record.lifecycle_state, session_record.issued_at,
           session_record.activated_at, session_record.closed_at,
           session_record.expires_at, session_record.closed_reason,
           session_record.version;
END
$function$;

CREATE FUNCTION seb.validate_session_header(
    p_validation_event_id uuid,
    p_tenant_id uuid,
    p_session_id uuid,
    p_header_kind text,
    p_header_present boolean,
    p_presented_header_hash char(64),
    p_request_fingerprint_hash char(64)
)
RETURNS TABLE (
    session_id uuid,
    configuration_id uuid,
    attempt_id uuid,
    header_kind text,
    validation_result text,
    occurred_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, seb, authz, app
AS $function$
DECLARE
    session_record seb.sessions%ROWTYPE;
    configuration_record seb.configurations%ROWTYPE;
    result_state text;
    event_time timestamptz := clock_timestamp();
    expected_hash char(64);
BEGIN
    IF p_validation_event_id IS NULL OR p_tenant_id IS NULL OR p_session_id IS NULL
       OR p_header_kind NOT IN ('config_key', 'browser_exam_key')
       OR (p_header_present AND p_presented_header_hash IS NULL) THEN
        RAISE EXCEPTION 'invalid SEB header validation' USING ERRCODE = '22023';
    END IF;
    IF NOT authz.current_context_allows(p_tenant_id, 'seb.write', 'seb.validation_events') THEN
        RAISE EXCEPTION 'current authorization context cannot validate an SEB header'
            USING ERRCODE = '42501';
    END IF;
    SELECT * INTO session_record
    FROM seb.sessions
    WHERE id = p_session_id AND tenant_id = p_tenant_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RETURN;
    END IF;
    SELECT * INTO configuration_record
    FROM seb.configurations
    WHERE id = session_record.configuration_id
      AND tenant_id = session_record.tenant_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RETURN;
    END IF;

    IF configuration_record.lifecycle_state = 'revoked' THEN
        result_state := 'revoked_configuration';
    ELSIF session_record.lifecycle_state IN ('closed', 'revoked') THEN
        result_state := 'closed_session';
    ELSIF session_record.lifecycle_state = 'expired' OR session_record.expires_at <= event_time THEN
        result_state := 'expired_session';
        IF session_record.lifecycle_state IN ('issued', 'active') THEN
            UPDATE seb.sessions
            SET lifecycle_state = 'expired', closed_at = event_time,
                closed_reason = 'expired', version = version + 1
            WHERE id = session_record.id AND tenant_id = session_record.tenant_id;
        END IF;
    ELSIF NOT p_header_present THEN
        result_state := 'missing';
    ELSE
        expected_hash := CASE p_header_kind
            WHEN 'config_key' THEN configuration_record.config_key_hash
            ELSE configuration_record.browser_exam_key_hash
        END;
        IF expected_hash IS NOT NULL AND expected_hash = p_presented_header_hash THEN
            result_state := 'matched';
            IF session_record.lifecycle_state = 'issued' THEN
                UPDATE seb.sessions
                SET lifecycle_state = 'active', activated_at = event_time,
                    version = version + 1
                WHERE id = session_record.id AND tenant_id = session_record.tenant_id
                  AND lifecycle_state = 'issued';
            END IF;
        ELSE
            result_state := 'mismatched';
        END IF;
    END IF;

    INSERT INTO seb.validation_events (
        id, occurred_at, tenant_id, configuration_id, session_id, attempt_id,
        header_kind, header_present, validation_result, request_fingerprint_hash
    ) VALUES (
        p_validation_event_id, event_time, session_record.tenant_id,
        configuration_record.id, session_record.id, session_record.attempt_id,
        p_header_kind, p_header_present, result_state, p_request_fingerprint_hash
    );
    RETURN QUERY SELECT session_record.id, configuration_record.id,
        session_record.attempt_id, p_header_kind, result_state, event_time;
END
$function$;

REVOKE ALL ON FUNCTION seb.rotate_configuration(
    uuid, uuid, uuid, uuid, uuid, uuid, uuid, integer, text, char(64),
    char(64), text, char(64), text, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION seb.revoke_configuration(uuid, uuid, uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION seb.issue_session(uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, char(64)) FROM PUBLIC;
REVOKE ALL ON FUNCTION seb.validate_session_header(uuid, uuid, uuid, text, boolean, char(64), char(64)) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION seb.rotate_configuration(
    uuid, uuid, uuid, uuid, uuid, uuid, uuid, integer, text, char(64),
    char(64), text, char(64), text, uuid
) TO aether_seb_app;
GRANT EXECUTE ON FUNCTION seb.revoke_configuration(uuid, uuid, uuid, text, uuid) TO aether_seb_app;
GRANT EXECUTE ON FUNCTION seb.issue_session(uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, char(64)) TO aether_seb_app;
GRANT EXECUTE ON FUNCTION seb.validate_session_header(uuid, uuid, uuid, text, boolean, char(64), char(64)) TO aether_seb_app;

RESET ROLE;
