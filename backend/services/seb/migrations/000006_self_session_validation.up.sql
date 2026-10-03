-- Bind validation to the signed RLS actor rather than a caller-selected
-- validation-event UUID. The existing executable function signature is
-- replaced in place so no app-accessible legacy bypass remains.
SET ROLE aether_seb_owner;

CREATE OR REPLACE FUNCTION authz.current_context_actor_id()
RETURNS uuid
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, authz, app
AS $function$
    SELECT context_row.actor_id
    FROM authz.request_contexts AS context_row
    WHERE context_row.context_id = app.current_context_id()
      AND context_row.backend_pid = pg_backend_pid()
      AND context_row.transaction_id = txid_current()
      AND context_row.expires_at > clock_timestamp()
$function$;

ALTER TABLE seb.validation_events
    DROP CONSTRAINT IF EXISTS validation_events_validation_result_check;
ALTER TABLE seb.validation_events
    ADD CONSTRAINT validation_events_validation_result_check CHECK (
        validation_result IN (
            'matched', 'missing', 'mismatched', 'not_required',
            'expired_session', 'closed_session', 'revoked_configuration'
        )
    );

CREATE OR REPLACE FUNCTION seb.validate_session_header(
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
    signed_actor_id uuid;
BEGIN
    IF p_validation_event_id IS NULL OR p_tenant_id IS NULL OR p_session_id IS NULL
       OR p_header_kind NOT IN ('config_key', 'browser_exam_key')
       OR p_request_fingerprint_hash IS NULL
       OR (p_header_present AND p_presented_header_hash IS NULL) THEN
        RAISE EXCEPTION 'invalid SEB header validation' USING ERRCODE = '22023';
    END IF;
    IF NOT authz.current_context_allows(p_tenant_id, 'seb.write', 'seb.validation_events') THEN
        RAISE EXCEPTION 'current authorization context cannot validate an SEB header'
            USING ERRCODE = '42501';
    END IF;
    signed_actor_id := authz.current_context_actor_id();
    IF signed_actor_id IS NULL THEN
        RAISE EXCEPTION 'current authorization context has no actor' USING ERRCODE = '42501';
    END IF;

    -- Candidate binding is made inside the RLS-scoped procedure. Returning no
    -- row yields the same generic denial for an unknown session and another
    -- candidate's session, without disclosing existence or metadata.
    SELECT * INTO session_record
    FROM seb.sessions
    WHERE id = p_session_id
      AND tenant_id = p_tenant_id
      AND candidate_id = signed_actor_id
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
    ELSIF p_header_kind = 'browser_exam_key' AND configuration_record.browser_exam_key_hash IS NULL THEN
        result_state := 'not_required';
    ELSIF NOT p_header_present THEN
        result_state := 'missing';
    ELSE
        expected_hash := CASE p_header_kind
            WHEN 'config_key' THEN configuration_record.config_key_hash
            ELSE configuration_record.browser_exam_key_hash
        END;
        IF expected_hash = p_presented_header_hash THEN
            result_state := 'matched';
            -- A browser-key validation must never activate a session. The
            -- non-optional configuration key is the activation proof.
            IF p_header_kind = 'config_key' AND session_record.lifecycle_state = 'issued' THEN
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

REVOKE ALL ON FUNCTION authz.current_context_actor_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION seb.validate_session_header(uuid, uuid, uuid, text, boolean, char(64), char(64)) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION seb.validate_session_header(uuid, uuid, uuid, text, boolean, char(64), char(64))
    TO aether_seb_app;

RESET ROLE;
