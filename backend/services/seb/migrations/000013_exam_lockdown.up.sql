-- Exam lockdown (ADR-0022). A real Safe Exam Browser cannot send custom
-- headers; on every request it sends
--   X-SafeExamBrowser-RequestHash   = sha256(absolute URL + Browser Exam Key)
--   X-SafeExamBrowser-ConfigKeyHash = sha256(absolute URL + Config Key)
-- so validating needs the keys themselves and the request URL. Staff save the
-- keys their SEB configuration reports on the exam's policy; while a candidate
-- has an open assignment to a locked exam, Gateway asks check_exam_request
-- whether the request carries a hash for one of those keys. The keys never
-- leave this database: the check is a SECURITY DEFINER procedure.
SET ROLE aether_seb_owner;

-- 000009 granted the projection worker its inbox and close procedures but not
-- the schema, so the lifecycle projection never ran.
GRANT USAGE ON SCHEMA seb TO aether_seb_projection_worker;

-- Candidate assignments, projected from assessment.candidate_assignment.snapshot.v1.
CREATE TABLE seb.candidate_assignments (
    tenant_id uuid NOT NULL,
    candidate_assignment_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    exam_id uuid NOT NULL,
    available_from timestamptz,
    available_until timestamptz,
    lifecycle_state text NOT NULL CHECK (lifecycle_state IN ('active', 'revoked')),
    snapshot_version bigint NOT NULL CHECK (snapshot_version > 0),
    PRIMARY KEY (tenant_id, candidate_assignment_id)
);
CREATE INDEX candidate_assignments_open_idx
    ON seb.candidate_assignments (tenant_id, candidate_id, exam_id)
    WHERE lifecycle_state = 'active';

CREATE FUNCTION seb.valid_exam_keys(p_keys text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
    SELECT coalesce(bool_and(key ~ '^[0-9a-f]{64}$'), true) FROM unnest(p_keys) AS key
$function$;

-- One lockdown policy per exam. accepted_keys holds Browser Exam Keys and
-- Config Keys alike: a request passes when either SEB header matches any key.
CREATE TABLE seb.exam_policies (
    tenant_id uuid NOT NULL,
    exam_id uuid NOT NULL,
    title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
    enabled boolean NOT NULL,
    accepted_keys text[] NOT NULL CHECK (cardinality(accepted_keys) <= 16 AND seb.valid_exam_keys(accepted_keys)),
    updated_by uuid NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    PRIMARY KEY (tenant_id, exam_id),
    CHECK (NOT enabled OR cardinality(accepted_keys) >= 1)
);

ALTER TABLE seb.candidate_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE seb.candidate_assignments FORCE ROW LEVEL SECURITY;
ALTER TABLE seb.exam_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE seb.exam_policies FORCE ROW LEVEL SECURITY;

-- Assignments are reached only through the owner's procedures below.
CREATE POLICY seb_candidate_assignments_owner_maintenance ON seb.candidate_assignments
    FOR ALL TO aether_seb_owner USING (true) WITH CHECK (true);
CREATE POLICY seb_exam_policies_owner_maintenance ON seb.exam_policies
    FOR ALL TO aether_seb_owner USING (true) WITH CHECK (true);
-- Staff manage policies with the configurations capability.
CREATE POLICY seb_exam_policies_signed_read ON seb.exam_policies FOR SELECT TO aether_seb_app
    USING (authz.current_context_allows_read(tenant_id, 'seb.read', 'seb.write', 'seb.configurations'));
CREATE POLICY seb_exam_policies_signed_insert ON seb.exam_policies FOR INSERT TO aether_seb_app
    WITH CHECK (authz.current_context_allows(tenant_id, 'seb.write', 'seb.configurations'));
CREATE POLICY seb_exam_policies_signed_update ON seb.exam_policies FOR UPDATE TO aether_seb_app
    USING (authz.current_context_allows(tenant_id, 'seb.write', 'seb.configurations'))
    WITH CHECK (authz.current_context_allows(tenant_id, 'seb.write', 'seb.configurations'));
GRANT SELECT, INSERT, UPDATE ON seb.exam_policies TO aether_seb_app;

-- Applies one assignment snapshot; an older snapshot never overwrites a newer one.
CREATE FUNCTION seb.apply_candidate_assignment_snapshot(
    p_tenant_id uuid,
    p_candidate_assignment_id uuid,
    p_candidate_id uuid,
    p_exam_id uuid,
    p_available_from timestamptz,
    p_available_until timestamptz,
    p_lifecycle_state text,
    p_snapshot_version bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, seb
AS $function$
BEGIN
    IF p_tenant_id IS NULL OR p_candidate_assignment_id IS NULL OR p_candidate_id IS NULL
       OR p_exam_id IS NULL OR p_snapshot_version IS NULL THEN
        RAISE EXCEPTION 'invalid candidate assignment snapshot' USING ERRCODE = '22023';
    END IF;
    INSERT INTO seb.candidate_assignments AS existing (
        tenant_id, candidate_assignment_id, candidate_id, exam_id,
        available_from, available_until, lifecycle_state, snapshot_version
    ) VALUES (
        p_tenant_id, p_candidate_assignment_id, p_candidate_id, p_exam_id,
        p_available_from, p_available_until, p_lifecycle_state, p_snapshot_version
    )
    ON CONFLICT (tenant_id, candidate_assignment_id) DO UPDATE
    SET candidate_id = EXCLUDED.candidate_id,
        exam_id = EXCLUDED.exam_id,
        available_from = EXCLUDED.available_from,
        available_until = EXCLUDED.available_until,
        lifecycle_state = EXCLUDED.lifecycle_state,
        snapshot_version = EXCLUDED.snapshot_version
    WHERE existing.snapshot_version < EXCLUDED.snapshot_version;
END
$function$;

-- The open assignments of the signed actor whose exam is locked. An attempt
-- may run a little past the window (deadline grace, time-up), hence the
-- five-minute tail.
CREATE FUNCTION seb.locked_exam_keys(p_tenant_id uuid, p_actor_id uuid)
RETURNS TABLE (exam_id uuid, title text, accepted_keys text[])
LANGUAGE sql

SECURITY DEFINER
SET search_path = pg_catalog, seb
AS $function$
    SELECT policy.exam_id, policy.title, policy.accepted_keys
    FROM seb.candidate_assignments AS assignment
    JOIN seb.exam_policies AS policy
      ON policy.tenant_id = assignment.tenant_id
     AND policy.exam_id = assignment.exam_id
     AND policy.enabled
    WHERE assignment.tenant_id = p_tenant_id
      AND assignment.candidate_id = p_actor_id
      AND assignment.lifecycle_state = 'active'
      AND (assignment.available_from IS NULL OR assignment.available_from <= clock_timestamp())
      AND (assignment.available_until IS NULL
           OR assignment.available_until + interval '5 minutes' > clock_timestamp())
$function$;

-- Gateway's per-request check. Returns not_required, missing, matched or
-- mismatched; only the first and third let the request through.
CREATE FUNCTION seb.check_exam_request(
    p_tenant_id uuid,
    p_url text,
    p_request_hash text,
    p_config_key_hash text
)
RETURNS text
LANGUAGE plpgsql

SECURITY DEFINER
SET search_path = pg_catalog, seb, authz, app
AS $function$
DECLARE
    actor_id uuid;
    locked boolean;
    matched boolean;
BEGIN
    IF p_tenant_id IS NULL OR p_url IS NULL OR length(p_url) NOT BETWEEN 8 AND 8192
       OR p_url !~ '^https?://' OR p_url ~ '#'
       OR (p_request_hash IS NOT NULL AND p_request_hash !~ '^[0-9a-f]{64}$')
       OR (p_config_key_hash IS NOT NULL AND p_config_key_hash !~ '^[0-9a-f]{64}$') THEN
        RAISE EXCEPTION 'invalid SEB request check' USING ERRCODE = '22023';
    END IF;
    -- Read access to one's own SEB state: students hold it as a self grant,
    -- staff and mentors through their tenant roles.
    IF NOT authz.current_context_allows(p_tenant_id, 'seb.read', 'seb.sessions') THEN
        RAISE EXCEPTION 'current authorization context cannot check an SEB request' USING ERRCODE = '42501';
    END IF;
    actor_id := authz.current_context_actor_id();
    IF actor_id IS NULL THEN
        RAISE EXCEPTION 'current authorization context has no actor' USING ERRCODE = '42501';
    END IF;

    SELECT count(*) > 0,
           coalesce(bool_or(EXISTS (
               SELECT 1 FROM unnest(locked_exam.accepted_keys) AS key
               WHERE encode(sha256(convert_to(p_url || key, 'UTF8')), 'hex')
                     IN (p_request_hash, p_config_key_hash)
           )), false)
    INTO locked, matched
    FROM seb.locked_exam_keys(p_tenant_id, actor_id) AS locked_exam;

    IF NOT locked THEN
        RETURN 'not_required';
    ELSIF p_request_hash IS NULL AND p_config_key_hash IS NULL THEN
        RETURN 'missing';
    ELSIF matched THEN
        RETURN 'matched';
    END IF;
    RETURN 'mismatched';
END
$function$;

-- The title of a locked exam the signed candidate is assigned to, for the
-- .seb launch file. No row: not assigned, not locked, or the window closed.
CREATE FUNCTION seb.candidate_exam_launch(p_tenant_id uuid, p_exam_id uuid)
RETURNS text
LANGUAGE plpgsql

SECURITY DEFINER
SET search_path = pg_catalog, seb, authz, app
AS $function$
DECLARE
    actor_id uuid;
    exam_title text;
BEGIN
    IF p_tenant_id IS NULL OR p_exam_id IS NULL THEN
        RAISE EXCEPTION 'invalid SEB launch request' USING ERRCODE = '22023';
    END IF;
    IF NOT authz.current_context_allows(p_tenant_id, 'seb.read', 'seb.sessions') THEN
        RAISE EXCEPTION 'current authorization context cannot read an SEB launch file' USING ERRCODE = '42501';
    END IF;
    actor_id := authz.current_context_actor_id();
    IF actor_id IS NULL THEN
        RAISE EXCEPTION 'current authorization context has no actor' USING ERRCODE = '42501';
    END IF;
    SELECT policy.title INTO exam_title
    FROM seb.candidate_assignments AS assignment
    JOIN seb.exam_policies AS policy
      ON policy.tenant_id = assignment.tenant_id
     AND policy.exam_id = assignment.exam_id
     AND policy.enabled
    WHERE assignment.tenant_id = p_tenant_id
      AND assignment.exam_id = p_exam_id
      AND assignment.candidate_id = actor_id
      AND assignment.lifecycle_state = 'active'
      AND (assignment.available_until IS NULL OR assignment.available_until > clock_timestamp())
    LIMIT 1;
    RETURN exam_title;
END
$function$;

REVOKE ALL ON FUNCTION seb.valid_exam_keys(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION seb.apply_candidate_assignment_snapshot(uuid, uuid, uuid, uuid, timestamptz, timestamptz, text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION seb.locked_exam_keys(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION seb.check_exam_request(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION seb.candidate_exam_launch(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION seb.valid_exam_keys(text[]) TO aether_seb_app;
GRANT EXECUTE ON FUNCTION seb.apply_candidate_assignment_snapshot(uuid, uuid, uuid, uuid, timestamptz, timestamptz, text, bigint)
    TO aether_seb_projection_worker;
GRANT EXECUTE ON FUNCTION seb.check_exam_request(uuid, text, text, text) TO aether_seb_app;
GRANT EXECUTE ON FUNCTION seb.candidate_exam_launch(uuid, uuid) TO aether_seb_app;

RESET ROLE;
