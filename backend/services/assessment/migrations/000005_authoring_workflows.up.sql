-- Aggregate writes span immutable snapshots and their parent metadata. These
-- security-definer routines keep that work transactional while checking the
-- exact, short-lived RLS capability that admitted the HTTP request. Direct
-- DML is removed from child snapshots so an app connection cannot combine a
-- capability for one table with writes to another.
SET ROLE aether_assessment_owner;

ALTER TABLE assessment.exam_versions
    ADD COLUMN content_version bigint NOT NULL DEFAULT 1 CHECK (content_version > 0);
ALTER TABLE assessment.exam_versions ALTER COLUMN content_version DROP DEFAULT;

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

CREATE FUNCTION assessment.create_proctor_policy_version(
    p_id uuid,
    p_tenant_id uuid,
    p_proctor_policy_id uuid,
    p_expected_policy_version bigint,
    p_policy jsonb,
    p_policy_checksum text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, assessment, authz
AS $function$
DECLARE
    policy_row assessment.proctor_policies%ROWTYPE;
    next_version_number integer;
    actor_id uuid;
BEGIN
    IF p_id IS NULL OR p_tenant_id IS NULL OR p_proctor_policy_id IS NULL
       OR p_expected_policy_version IS NULL OR p_expected_policy_version <= 0
       OR jsonb_typeof(p_policy) <> 'object'
       OR p_policy_checksum !~* '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'invalid proctor policy version command' USING ERRCODE = '22023';
    END IF;
    IF NOT authz.current_context_allows(p_tenant_id, 'assessment.write', 'assessment.proctor_policy_versions') THEN
        RAISE EXCEPTION 'authorization denied' USING ERRCODE = '42501';
    END IF;
    actor_id := authz.current_context_actor_id();
    IF actor_id IS NULL THEN
        RAISE EXCEPTION 'authorization context is unavailable' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO policy_row
    FROM assessment.proctor_policies
    WHERE id = p_proctor_policy_id AND tenant_id = p_tenant_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'proctor policy was not found' USING ERRCODE = 'P0002';
    END IF;
    IF policy_row.lifecycle_state <> 'active' THEN
        RAISE EXCEPTION 'archived proctor policy cannot receive a version' USING ERRCODE = '40001';
    END IF;
    IF policy_row.version <> p_expected_policy_version THEN
        RAISE EXCEPTION 'proctor policy version is stale' USING ERRCODE = '40001';
    END IF;

    SELECT COALESCE(max(version_number), 0) + 1 INTO next_version_number
    FROM assessment.proctor_policy_versions
    WHERE tenant_id = p_tenant_id AND proctor_policy_id = p_proctor_policy_id;

    INSERT INTO assessment.proctor_policy_versions (
        id, tenant_id, proctor_policy_id, version_number, policy, policy_checksum, created_by
    ) VALUES (
        p_id, p_tenant_id, p_proctor_policy_id, next_version_number, p_policy, p_policy_checksum, actor_id
    );
    UPDATE assessment.proctor_policies
    SET version = version + 1
    WHERE id = p_proctor_policy_id AND tenant_id = p_tenant_id;
END
$function$;

CREATE FUNCTION assessment.publish_proctor_policy_version(
    p_tenant_id uuid,
    p_proctor_policy_version_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, assessment, authz
AS $function$
BEGIN
    IF p_tenant_id IS NULL OR p_proctor_policy_version_id IS NULL THEN
        RAISE EXCEPTION 'proctor policy version identifiers are required' USING ERRCODE = '22023';
    END IF;
    IF NOT authz.current_context_allows(p_tenant_id, 'assessment.write', 'assessment.proctor_policy_versions') THEN
        RAISE EXCEPTION 'authorization denied' USING ERRCODE = '42501';
    END IF;
    UPDATE assessment.proctor_policy_versions
    SET status = 'published', published_at = clock_timestamp()
    WHERE id = p_proctor_policy_version_id
      AND tenant_id = p_tenant_id
      AND status = 'draft';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'draft proctor policy version was not found' USING ERRCODE = '40001';
    END IF;
END
$function$;

CREATE FUNCTION assessment.create_exam_version(
    p_id uuid,
    p_tenant_id uuid,
    p_exam_id uuid,
    p_expected_exam_version bigint,
    p_title text,
    p_instructions_markdown text,
    p_opens_at timestamptz,
    p_closes_at timestamptz,
    p_duration_seconds integer,
    p_proctor_policy_version_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, assessment, authz
AS $function$
DECLARE
    exam_row assessment.exams%ROWTYPE;
    next_version_number integer;
    actor_id uuid;
BEGIN
    IF p_id IS NULL OR p_tenant_id IS NULL OR p_exam_id IS NULL
       OR p_expected_exam_version IS NULL OR p_expected_exam_version <= 0
       OR p_title IS NULL OR length(btrim(p_title)) = 0
       OR p_instructions_markdown IS NULL OR length(p_instructions_markdown) = 0
       OR p_opens_at IS NULL OR p_closes_at IS NULL OR p_opens_at >= p_closes_at
       OR p_duration_seconds IS NULL OR p_duration_seconds NOT BETWEEN 60 AND 43200
       OR p_duration_seconds > extract(epoch FROM p_closes_at - p_opens_at)::integer
       OR p_proctor_policy_version_id IS NULL THEN
        RAISE EXCEPTION 'invalid exam version command' USING ERRCODE = '22023';
    END IF;
    IF NOT authz.current_context_allows(p_tenant_id, 'assessment.write', 'assessment.exam_versions') THEN
        RAISE EXCEPTION 'authorization denied' USING ERRCODE = '42501';
    END IF;
    actor_id := authz.current_context_actor_id();
    IF actor_id IS NULL THEN
        RAISE EXCEPTION 'authorization context is unavailable' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO exam_row
    FROM assessment.exams
    WHERE id = p_exam_id AND tenant_id = p_tenant_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'exam was not found' USING ERRCODE = 'P0002';
    END IF;
    IF exam_row.lifecycle_state = 'archived' THEN
        RAISE EXCEPTION 'archived exam cannot receive a version' USING ERRCODE = '40001';
    END IF;
    IF exam_row.version <> p_expected_exam_version THEN
        RAISE EXCEPTION 'exam version is stale' USING ERRCODE = '40001';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM assessment.proctor_policy_versions
        WHERE id = p_proctor_policy_version_id
          AND tenant_id = p_tenant_id
          AND status = 'published'
    ) THEN
        RAISE EXCEPTION 'published proctor policy version was not found' USING ERRCODE = '22023';
    END IF;

    SELECT COALESCE(max(version_number), 0) + 1 INTO next_version_number
    FROM assessment.exam_versions
    WHERE tenant_id = p_tenant_id AND exam_id = p_exam_id;

    INSERT INTO assessment.exam_versions (
        id, tenant_id, exam_id, version_number, title, instructions_markdown,
        opens_at, closes_at, duration_seconds, proctor_policy_version_id, created_by
    ) VALUES (
        p_id, p_tenant_id, p_exam_id, next_version_number, btrim(p_title), p_instructions_markdown,
        p_opens_at, p_closes_at, p_duration_seconds, p_proctor_policy_version_id, actor_id
    );
    UPDATE assessment.exams
    SET version = version + 1, updated_at = clock_timestamp()
    WHERE id = p_exam_id AND tenant_id = p_tenant_id;
END
$function$;

CREATE FUNCTION assessment.add_exam_section(
    p_id uuid,
    p_tenant_id uuid,
    p_exam_version_id uuid,
    p_expected_content_version bigint,
    p_position integer,
    p_title text,
    p_instructions_markdown text,
    p_time_limit_seconds integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, assessment, authz
AS $function$
DECLARE version_row assessment.exam_versions%ROWTYPE;
BEGIN
    IF p_id IS NULL OR p_tenant_id IS NULL OR p_exam_version_id IS NULL
       OR p_expected_content_version IS NULL OR p_expected_content_version <= 0
       OR p_position IS NULL OR p_position <= 0
       OR p_title IS NULL OR length(btrim(p_title)) = 0
       OR p_instructions_markdown IS NULL
       OR (p_time_limit_seconds IS NOT NULL AND p_time_limit_seconds NOT BETWEEN 60 AND 43200) THEN
        RAISE EXCEPTION 'invalid exam section command' USING ERRCODE = '22023';
    END IF;
    IF NOT authz.current_context_allows(p_tenant_id, 'assessment.write', 'assessment.exam_sections') THEN
        RAISE EXCEPTION 'authorization denied' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO version_row
    FROM assessment.exam_versions
    WHERE id = p_exam_version_id AND tenant_id = p_tenant_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'exam version was not found' USING ERRCODE = 'P0002';
    END IF;
    IF version_row.status <> 'draft' THEN
        RAISE EXCEPTION 'published exam version is immutable' USING ERRCODE = '40001';
    END IF;
    IF version_row.content_version <> p_expected_content_version THEN
        RAISE EXCEPTION 'exam content version is stale' USING ERRCODE = '40001';
    END IF;
    IF p_time_limit_seconds IS NOT NULL AND p_time_limit_seconds > version_row.duration_seconds THEN
        RAISE EXCEPTION 'section limit exceeds exam duration' USING ERRCODE = '22023';
    END IF;

    INSERT INTO assessment.exam_sections (
        id, tenant_id, exam_version_id, position, title, instructions_markdown, time_limit_seconds
    ) VALUES (
        p_id, p_tenant_id, p_exam_version_id, p_position, btrim(p_title), p_instructions_markdown, p_time_limit_seconds
    );
    UPDATE assessment.exam_versions
    SET content_version = content_version + 1
    WHERE id = p_exam_version_id AND tenant_id = p_tenant_id;
END
$function$;

CREATE FUNCTION assessment.add_exam_item(
    p_id uuid,
    p_tenant_id uuid,
    p_exam_version_id uuid,
    p_section_id uuid,
    p_expected_content_version bigint,
    p_position integer,
    p_question_id uuid,
    p_question_version_id uuid,
    p_maximum_score numeric(12,4),
    p_evaluation_bundle_checksum text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, assessment, authz
AS $function$
DECLARE version_row assessment.exam_versions%ROWTYPE;
BEGIN
    IF p_id IS NULL OR p_tenant_id IS NULL OR p_exam_version_id IS NULL OR p_section_id IS NULL
       OR p_expected_content_version IS NULL OR p_expected_content_version <= 0
       OR p_position IS NULL OR p_position <= 0
       OR p_question_id IS NULL OR p_question_version_id IS NULL
       OR p_maximum_score IS NULL OR p_maximum_score <= 0
       OR p_evaluation_bundle_checksum !~* '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'invalid exam item command' USING ERRCODE = '22023';
    END IF;
    IF NOT authz.current_context_allows(p_tenant_id, 'assessment.write', 'assessment.exam_items') THEN
        RAISE EXCEPTION 'authorization denied' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO version_row
    FROM assessment.exam_versions
    WHERE id = p_exam_version_id AND tenant_id = p_tenant_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'exam version was not found' USING ERRCODE = 'P0002';
    END IF;
    IF version_row.status <> 'draft' THEN
        RAISE EXCEPTION 'published exam version is immutable' USING ERRCODE = '40001';
    END IF;
    IF version_row.content_version <> p_expected_content_version THEN
        RAISE EXCEPTION 'exam content version is stale' USING ERRCODE = '40001';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM assessment.exam_sections
        WHERE id = p_section_id AND tenant_id = p_tenant_id AND exam_version_id = p_exam_version_id
    ) THEN
        RAISE EXCEPTION 'exam section was not found' USING ERRCODE = 'P0002';
    END IF;

    INSERT INTO assessment.exam_items (
        id, tenant_id, exam_version_id, section_id, position, question_id, question_version_id,
        maximum_score, evaluation_bundle_checksum
    ) VALUES (
        p_id, p_tenant_id, p_exam_version_id, p_section_id, p_position, p_question_id, p_question_version_id,
        p_maximum_score, p_evaluation_bundle_checksum
    );
    UPDATE assessment.exam_versions
    SET content_version = content_version + 1
    WHERE id = p_exam_version_id AND tenant_id = p_tenant_id;
END
$function$;

CREATE FUNCTION assessment.publish_exam_version(
    p_tenant_id uuid,
    p_exam_version_id uuid,
    p_expected_content_version bigint,
    p_event_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, assessment, authz
AS $function$
DECLARE version_row assessment.exam_versions%ROWTYPE;
DECLARE actor_id uuid;
BEGIN
    IF p_tenant_id IS NULL OR p_exam_version_id IS NULL OR p_event_id IS NULL
       OR p_expected_content_version IS NULL OR p_expected_content_version <= 0 THEN
        RAISE EXCEPTION 'invalid exam publication command' USING ERRCODE = '22023';
    END IF;
    IF NOT authz.current_context_allows(p_tenant_id, 'assessment.write', 'assessment.exam_versions') THEN
        RAISE EXCEPTION 'authorization denied' USING ERRCODE = '42501';
    END IF;
    actor_id := authz.current_context_actor_id();
    IF actor_id IS NULL THEN
        RAISE EXCEPTION 'authorization context is unavailable' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO version_row
    FROM assessment.exam_versions
    WHERE id = p_exam_version_id AND tenant_id = p_tenant_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'exam version was not found' USING ERRCODE = 'P0002';
    END IF;
    IF version_row.status <> 'draft' THEN
        RAISE EXCEPTION 'draft exam version was not found' USING ERRCODE = '40001';
    END IF;
    IF version_row.content_version <> p_expected_content_version THEN
        RAISE EXCEPTION 'exam content version is stale' USING ERRCODE = '40001';
    END IF;
    IF version_row.closes_at <= clock_timestamp() THEN
        RAISE EXCEPTION 'closed exam version cannot be published' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM assessment.exam_sections
        WHERE tenant_id = p_tenant_id AND exam_version_id = p_exam_version_id
    ) OR NOT EXISTS (
        SELECT 1 FROM assessment.exam_items
        WHERE tenant_id = p_tenant_id AND exam_version_id = p_exam_version_id
    ) THEN
        RAISE EXCEPTION 'exam version requires at least one section and item' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM assessment.proctor_policy_versions
        WHERE id = version_row.proctor_policy_version_id
          AND tenant_id = p_tenant_id AND status = 'published'
    ) THEN
        RAISE EXCEPTION 'exam version requires a published proctor policy' USING ERRCODE = '22023';
    END IF;

    UPDATE assessment.exam_versions
    SET status = 'published', published_at = clock_timestamp()
    WHERE id = p_exam_version_id AND tenant_id = p_tenant_id;
    UPDATE assessment.exams
    SET lifecycle_state = 'published', updated_at = clock_timestamp(), version = version + 1
    WHERE id = version_row.exam_id AND tenant_id = p_tenant_id AND lifecycle_state <> 'archived';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'exam was archived during publication' USING ERRCODE = '40001';
    END IF;
    INSERT INTO assessment.exam_events (
        id, tenant_id, exam_id, exam_version_id, actor_id, event_type, payload
    ) VALUES (
        p_event_id, p_tenant_id, version_row.exam_id, p_exam_version_id, actor_id,
        'assessment.exam_version.published.v1',
        jsonb_build_object(
            'exam_id', version_row.exam_id::text,
            'exam_version_id', p_exam_version_id::text,
            'version_number', version_row.version_number,
            'content_version', version_row.content_version
        )
    );
END
$function$;

CREATE FUNCTION assessment.create_assignment_rule(
    p_id uuid,
    p_tenant_id uuid,
    p_exam_version_id uuid,
    p_target_type text,
    p_target_id uuid,
    p_available_from timestamptz,
    p_available_until timestamptz,
    p_accommodations jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, assessment, authz
AS $function$
DECLARE version_row assessment.exam_versions%ROWTYPE;
DECLARE actor_id uuid;
BEGIN
    IF p_id IS NULL OR p_tenant_id IS NULL OR p_exam_version_id IS NULL OR p_target_id IS NULL
       OR p_target_type NOT IN ('department', 'batch', 'placement_department', 'student')
       OR p_available_from IS NULL OR p_available_until IS NULL OR p_available_from >= p_available_until
       OR jsonb_typeof(p_accommodations) <> 'object' THEN
        RAISE EXCEPTION 'invalid assignment rule command' USING ERRCODE = '22023';
    END IF;
    IF NOT authz.current_context_allows(p_tenant_id, 'assessment.write', 'assessment.assignment_rules') THEN
        RAISE EXCEPTION 'authorization denied' USING ERRCODE = '42501';
    END IF;
    actor_id := authz.current_context_actor_id();
    IF actor_id IS NULL THEN
        RAISE EXCEPTION 'authorization context is unavailable' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO version_row
    FROM assessment.exam_versions
    WHERE id = p_exam_version_id AND tenant_id = p_tenant_id;
    IF NOT FOUND OR version_row.status <> 'published' THEN
        RAISE EXCEPTION 'published exam version was not found' USING ERRCODE = '22023';
    END IF;
    IF p_available_from < version_row.opens_at OR p_available_until > version_row.closes_at THEN
        RAISE EXCEPTION 'assignment availability must be within the exam window' USING ERRCODE = '22023';
    END IF;
    INSERT INTO assessment.assignment_rules (
        id, tenant_id, exam_version_id, target_type, target_id,
        available_from, available_until, accommodations, created_by
    ) VALUES (
        p_id, p_tenant_id, p_exam_version_id, p_target_type, p_target_id,
        p_available_from, p_available_until, p_accommodations, actor_id
    );
END
$function$;

CREATE FUNCTION assessment.materialize_direct_candidate_assignment(
    p_id uuid,
    p_tenant_id uuid,
    p_assignment_rule_id uuid,
    p_candidate_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, assessment, authz
AS $function$
DECLARE rule_row assessment.assignment_rules%ROWTYPE;
BEGIN
    IF p_id IS NULL OR p_tenant_id IS NULL OR p_assignment_rule_id IS NULL OR p_candidate_id IS NULL THEN
        RAISE EXCEPTION 'candidate assignment identifiers are required' USING ERRCODE = '22023';
    END IF;
    IF NOT authz.current_context_allows(p_tenant_id, 'assessment.write', 'assessment.candidate_assignments') THEN
        RAISE EXCEPTION 'authorization denied' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO rule_row
    FROM assessment.assignment_rules
    WHERE id = p_assignment_rule_id AND tenant_id = p_tenant_id
    FOR KEY SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'assignment rule was not found' USING ERRCODE = 'P0002';
    END IF;
    IF rule_row.disabled_at IS NOT NULL THEN
        RAISE EXCEPTION 'assignment rule is disabled' USING ERRCODE = '40001';
    END IF;
    IF rule_row.target_type <> 'student' OR rule_row.target_id <> p_candidate_id THEN
        RAISE EXCEPTION 'only the rule target student can be materialized directly' USING ERRCODE = '22023';
    END IF;
    IF rule_row.available_until <= clock_timestamp() THEN
        RAISE EXCEPTION 'expired assignment rule cannot be materialized' USING ERRCODE = '40001';
    END IF;
    INSERT INTO assessment.candidate_assignments (
        id, tenant_id, assignment_rule_id, exam_version_id, candidate_id, available_from, available_until
    ) VALUES (
        p_id, p_tenant_id, rule_row.id, rule_row.exam_version_id, p_candidate_id,
        rule_row.available_from, rule_row.available_until
    );
END
$function$;

REVOKE ALL ON FUNCTION authz.current_context_actor_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authz.current_context_actor_id() TO aether_assessment_app;
REVOKE ALL ON FUNCTION assessment.create_proctor_policy_version(uuid, uuid, uuid, bigint, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION assessment.publish_proctor_policy_version(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION assessment.create_exam_version(uuid, uuid, uuid, bigint, text, text, timestamptz, timestamptz, integer, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION assessment.add_exam_section(uuid, uuid, uuid, bigint, integer, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION assessment.add_exam_item(uuid, uuid, uuid, uuid, bigint, integer, uuid, uuid, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION assessment.publish_exam_version(uuid, uuid, bigint, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION assessment.create_assignment_rule(uuid, uuid, uuid, text, uuid, timestamptz, timestamptz, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION assessment.materialize_direct_candidate_assignment(uuid, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assessment.create_proctor_policy_version(uuid, uuid, uuid, bigint, jsonb, text) TO aether_assessment_app;
GRANT EXECUTE ON FUNCTION assessment.publish_proctor_policy_version(uuid, uuid) TO aether_assessment_app;
GRANT EXECUTE ON FUNCTION assessment.create_exam_version(uuid, uuid, uuid, bigint, text, text, timestamptz, timestamptz, integer, uuid) TO aether_assessment_app;
GRANT EXECUTE ON FUNCTION assessment.add_exam_section(uuid, uuid, uuid, bigint, integer, text, text, integer) TO aether_assessment_app;
GRANT EXECUTE ON FUNCTION assessment.add_exam_item(uuid, uuid, uuid, uuid, bigint, integer, uuid, uuid, numeric, text) TO aether_assessment_app;
GRANT EXECUTE ON FUNCTION assessment.publish_exam_version(uuid, uuid, bigint, uuid) TO aether_assessment_app;
GRANT EXECUTE ON FUNCTION assessment.create_assignment_rule(uuid, uuid, uuid, text, uuid, timestamptz, timestamptz, jsonb) TO aether_assessment_app;
GRANT EXECUTE ON FUNCTION assessment.materialize_direct_candidate_assignment(uuid, uuid, uuid, uuid) TO aether_assessment_app;

-- Application connections may create aggregate roots, but all nested and
-- cross-table writes must pass through the scoped routines above.
REVOKE UPDATE, DELETE ON assessment.proctor_policies, assessment.exams FROM aether_assessment_app;
REVOKE INSERT, UPDATE, DELETE ON assessment.proctor_policy_versions,
                             assessment.exam_versions,
                             assessment.exam_sections,
                             assessment.exam_items,
                             assessment.assignment_rules,
                             assessment.candidate_assignments,
                             assessment.exam_events
FROM aether_assessment_app;

RESET ROLE;
