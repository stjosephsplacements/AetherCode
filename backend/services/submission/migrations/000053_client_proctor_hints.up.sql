-- Client TF.js proctor hints (ADR-0078 phase 3, advisory only). These never
-- increment attempt_violation_counts and never feed auto-submit.
SET ROLE aether_submission_owner;

CREATE TABLE submission.attempt_client_proctor_hints (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    attempt_id uuid NOT NULL,
    kind text NOT NULL CHECK (kind IN ('face_missing', 'multiple_faces', 'phone_detected')),
    confidence real NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX attempt_client_proctor_hints_attempt_idx
    ON submission.attempt_client_proctor_hints (tenant_id, attempt_id, recorded_at DESC);

ALTER TABLE submission.attempt_client_proctor_hints ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission.attempt_client_proctor_hints FORCE ROW LEVEL SECURITY;
CREATE POLICY attempt_client_proctor_hints_owner ON submission.attempt_client_proctor_hints
    FOR ALL TO aether_submission_owner USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE submission.attempt_client_proctor_hints FROM PUBLIC;

CREATE FUNCTION submission.record_client_proctor_hint(
    p_tenant_id uuid, p_attempt_id uuid, p_kind text, p_confidence real
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, authz, submission
AS $function$
DECLARE
    v_candidate uuid;
    v_recent timestamptz;
BEGIN
    IF NOT authz.current_context_allows(p_tenant_id, 'submission.write', 'submission.attempts') THEN
        RAISE EXCEPTION 'signed authorization context does not allow recording client proctor hints'
            USING ERRCODE = '42501';
    END IF;
    IF p_tenant_id IS NULL OR p_attempt_id IS NULL OR p_confidence IS NULL
       OR p_kind IS NULL OR p_kind NOT IN ('face_missing', 'multiple_faces', 'phone_detected')
       OR p_confidence < 0 OR p_confidence > 1 THEN
        RAISE EXCEPTION 'client proctor hint is invalid' USING ERRCODE = '22023';
    END IF;
    SELECT candidate_id INTO v_candidate
    FROM submission.attempts
    WHERE tenant_id = p_tenant_id AND id = p_attempt_id AND deleted_at IS NULL;
    IF v_candidate IS NULL OR v_candidate <> authz.current_context_actor_id() THEN
        RAISE EXCEPTION 'attempt belongs to another candidate' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM submission.attempts AS attempt
        WHERE attempt.tenant_id = p_tenant_id AND attempt.id = p_attempt_id
          AND attempt.lifecycle_state = 'active' AND attempt.deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'candidate attempt was not found' USING ERRCODE = 'P0001';
    END IF;
    SELECT recorded_at INTO v_recent
    FROM submission.attempt_client_proctor_hints
    WHERE tenant_id = p_tenant_id AND attempt_id = p_attempt_id AND kind = p_kind
    ORDER BY recorded_at DESC LIMIT 1;
    IF v_recent IS NOT NULL AND v_recent > clock_timestamp() - interval '30 seconds' THEN
        RETURN;
    END IF;
  INSERT INTO submission.attempt_client_proctor_hints (tenant_id, attempt_id, kind, confidence)
  VALUES (p_tenant_id, p_attempt_id, p_kind, p_confidence);
END
$function$;

CREATE FUNCTION submission.list_client_proctor_hints(p_tenant_id uuid, p_attempt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, authz, submission
AS $function$
BEGIN
    IF NOT authz.current_context_allows(p_tenant_id, 'submission.read', 'submission.proctor_evidence') THEN
        RAISE EXCEPTION 'signed authorization context does not allow reading client proctor hints'
            USING ERRCODE = '42501';
    END IF;
    IF p_attempt_id IS NULL THEN
        RAISE EXCEPTION 'attempt identifier is invalid' USING ERRCODE = '22023';
    END IF;
    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'id', h.id, 'kind', h.kind, 'confidence', h.confidence, 'recorded_at', h.recorded_at
        ) ORDER BY h.recorded_at DESC)
        FROM submission.attempt_client_proctor_hints AS h
        WHERE h.tenant_id = p_tenant_id AND h.attempt_id = p_attempt_id
    ), '[]'::jsonb);
END
$function$;

REVOKE ALL ON FUNCTION submission.record_client_proctor_hint(uuid, uuid, text, real) FROM PUBLIC;
REVOKE ALL ON FUNCTION submission.list_client_proctor_hints(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submission.record_client_proctor_hint(uuid, uuid, text, real) TO aether_submission_app;
GRANT EXECUTE ON FUNCTION submission.list_client_proctor_hints(uuid, uuid) TO aether_submission_app;

RESET ROLE;