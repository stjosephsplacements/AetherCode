SET ROLE aether_assessment_owner;

CREATE TABLE assessment.proctor_policies (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    name text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
    lifecycle_state text NOT NULL DEFAULT 'active'
        CHECK (lifecycle_state IN ('active', 'archived')),
    created_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    archived_at timestamptz,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, name),
    CHECK ((lifecycle_state = 'archived') = (archived_at IS NOT NULL))
);

CREATE TABLE assessment.proctor_policy_versions (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    proctor_policy_id uuid NOT NULL,
    version_number integer NOT NULL CHECK (version_number > 0),
    policy jsonb NOT NULL CHECK (jsonb_typeof(policy) = 'object'),
    policy_checksum char(64) NOT NULL CHECK (policy_checksum ~* '^[0-9a-f]{64}$'),
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'retired')),
    published_at timestamptz,
    created_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, proctor_policy_id, version_number),
    FOREIGN KEY (tenant_id, proctor_policy_id)
        REFERENCES assessment.proctor_policies (tenant_id, id) ON DELETE RESTRICT,
    CHECK (
        (status = 'draft' AND published_at IS NULL)
        OR (status IN ('published', 'retired') AND published_at IS NOT NULL)
    )
);

CREATE TABLE assessment.exams (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    external_reference text,
    lifecycle_state text NOT NULL DEFAULT 'draft'
        CHECK (lifecycle_state IN ('draft', 'published', 'archived')),
    created_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    archived_at timestamptz,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, external_reference),
    CHECK ((lifecycle_state = 'archived') = (archived_at IS NOT NULL)),
    CHECK (external_reference IS NULL OR length(external_reference) BETWEEN 1 AND 160)
);

CREATE TABLE assessment.exam_versions (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    exam_id uuid NOT NULL,
    version_number integer NOT NULL CHECK (version_number > 0),
    title text NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
    instructions_markdown text NOT NULL CHECK (length(instructions_markdown) > 0),
    opens_at timestamptz NOT NULL,
    closes_at timestamptz NOT NULL,
    duration_seconds integer NOT NULL CHECK (duration_seconds BETWEEN 60 AND 43200),
    proctor_policy_version_id uuid NOT NULL,
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'retired')),
    published_at timestamptz,
    created_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, exam_id, version_number),
    FOREIGN KEY (tenant_id, exam_id)
        REFERENCES assessment.exams (tenant_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, proctor_policy_version_id)
        REFERENCES assessment.proctor_policy_versions (tenant_id, id) ON DELETE RESTRICT,
    CHECK (opens_at < closes_at),
    CHECK (
        (status = 'draft' AND published_at IS NULL)
        OR (status IN ('published', 'retired') AND published_at IS NOT NULL)
    )
);

CREATE INDEX exam_versions_tenant_window_idx
    ON assessment.exam_versions (tenant_id, opens_at, closes_at)
    WHERE status = 'published';

CREATE TABLE assessment.exam_sections (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    exam_version_id uuid NOT NULL,
    position integer NOT NULL CHECK (position > 0),
    title text NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
    instructions_markdown text NOT NULL DEFAULT '',
    time_limit_seconds integer CHECK (time_limit_seconds IS NULL OR time_limit_seconds BETWEEN 60 AND 43200),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, id, exam_version_id),
    UNIQUE (tenant_id, exam_version_id, position),
    FOREIGN KEY (tenant_id, exam_version_id)
        REFERENCES assessment.exam_versions (tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE assessment.exam_items (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    exam_version_id uuid NOT NULL,
    section_id uuid NOT NULL,
    position integer NOT NULL CHECK (position > 0),
    question_id uuid NOT NULL,
    question_version_id uuid NOT NULL,
    maximum_score numeric(12,4) NOT NULL CHECK (maximum_score > 0),
    evaluation_bundle_checksum char(64) NOT NULL
        CHECK (evaluation_bundle_checksum ~* '^[0-9a-f]{64}$'),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, section_id, position),
    FOREIGN KEY (tenant_id, section_id, exam_version_id)
        REFERENCES assessment.exam_sections (tenant_id, id, exam_version_id) ON DELETE RESTRICT
);

CREATE TABLE assessment.assignment_rules (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    exam_version_id uuid NOT NULL,
    target_type text NOT NULL
        CHECK (target_type IN ('department', 'batch', 'placement_department', 'student')),
    target_id uuid NOT NULL,
    available_from timestamptz NOT NULL,
    available_until timestamptz NOT NULL,
    accommodations jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(accommodations) = 'object'),
    disabled_at timestamptz,
    created_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, id, exam_version_id),
    FOREIGN KEY (tenant_id, exam_version_id)
        REFERENCES assessment.exam_versions (tenant_id, id) ON DELETE RESTRICT,
    CHECK (available_from < available_until)
);

CREATE INDEX assignment_rules_active_target_idx
    ON assessment.assignment_rules (tenant_id, target_type, target_id, available_from, available_until)
    WHERE disabled_at IS NULL;
CREATE UNIQUE INDEX assignment_rules_one_active_target_idx
    ON assessment.assignment_rules (tenant_id, exam_version_id, target_type, target_id)
    WHERE disabled_at IS NULL;

CREATE TABLE assessment.candidate_assignments (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    assignment_rule_id uuid NOT NULL,
    exam_version_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    available_from timestamptz NOT NULL,
    available_until timestamptz NOT NULL,
    lifecycle_state text NOT NULL DEFAULT 'assigned'
        CHECK (lifecycle_state IN ('assigned', 'revoked', 'started', 'completed', 'expired')),
    assigned_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at timestamptz,
    completed_at timestamptz,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, exam_version_id, candidate_id),
    FOREIGN KEY (tenant_id, assignment_rule_id, exam_version_id)
        REFERENCES assessment.assignment_rules (tenant_id, id, exam_version_id) ON DELETE RESTRICT,
    CHECK (available_from < available_until),
    CHECK ((lifecycle_state = 'revoked') = (revoked_at IS NOT NULL)),
    CHECK ((lifecycle_state = 'completed') = (completed_at IS NOT NULL))
);

CREATE INDEX candidate_assignments_candidate_idx
    ON assessment.candidate_assignments (tenant_id, candidate_id, available_from, available_until);

CREATE TABLE assessment.exam_events (
    id uuid NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    tenant_id uuid NOT NULL,
    exam_id uuid NOT NULL,
    exam_version_id uuid,
    actor_id uuid,
    event_type text NOT NULL CHECK (length(event_type) BETWEEN 1 AND 180),
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    retention_until timestamptz NOT NULL DEFAULT (CURRENT_TIMESTAMP + interval '7 years'),
    legal_hold boolean NOT NULL DEFAULT false,
    PRIMARY KEY (id, occurred_at),
    CHECK (retention_until >= occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE FUNCTION app.ensure_assessment_event_partitions(
    partition_through timestamptz DEFAULT (CURRENT_TIMESTAMP + interval '2 months')
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, assessment
AS $$
DECLARE
    partition_start timestamptz := date_trunc('month', CURRENT_TIMESTAMP);
    partition_limit timestamptz := date_trunc('month', partition_through);
    partition_end timestamptz;
    partition_name text;
BEGIN
    WHILE partition_start <= partition_limit LOOP
        partition_end := partition_start + interval '1 month';
        partition_name := format('exam_events_%s', to_char(partition_start, 'YYYYMM'));

        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS assessment.%I PARTITION OF assessment.exam_events FOR VALUES FROM (%L) TO (%L)',
            partition_name,
            partition_start,
            partition_end
        );
        EXECUTE format(
            'CREATE INDEX IF NOT EXISTS %I ON assessment.%I (tenant_id, exam_id, occurred_at DESC)',
            format('%s_tenant_exam_idx', partition_name),
            partition_name
        );
        EXECUTE format(
            'CREATE INDEX IF NOT EXISTS %I ON assessment.%I (retention_until) WHERE NOT legal_hold',
            format('%s_retention_idx', partition_name),
            partition_name
        );
        partition_start := partition_end;
    END LOOP;
END;
$$;

SELECT app.ensure_assessment_event_partitions();
REVOKE ALL ON FUNCTION app.ensure_assessment_event_partitions(timestamptz) FROM PUBLIC;

CREATE FUNCTION assessment.reject_published_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, assessment
AS $$
BEGIN
    IF TG_OP = 'DELETE' AND OLD.published_at IS NOT NULL THEN
        RAISE EXCEPTION 'published snapshot % is immutable', OLD.id USING ERRCODE = '55000';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.published_at IS NOT NULL THEN
        RAISE EXCEPTION 'published snapshot % is immutable', OLD.id USING ERRCODE = '55000';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE FUNCTION assessment.reject_published_exam_child_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, assessment
AS $$
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') AND EXISTS (
        SELECT 1 FROM assessment.exam_versions exam_version
        WHERE exam_version.id = OLD.exam_version_id
          AND exam_version.published_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'published exam snapshot % is immutable', OLD.exam_version_id USING ERRCODE = '55000';
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') AND EXISTS (
        SELECT 1 FROM assessment.exam_versions exam_version
        WHERE exam_version.id = NEW.exam_version_id
          AND exam_version.published_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'content cannot be attached to published exam snapshot %', NEW.exam_version_id USING ERRCODE = '55000';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE FUNCTION assessment.reject_exam_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    RAISE EXCEPTION 'exam events are append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER proctor_policy_versions_immutable_when_published
    BEFORE UPDATE OR DELETE ON assessment.proctor_policy_versions
    FOR EACH ROW EXECUTE FUNCTION assessment.reject_published_snapshot_mutation();
CREATE TRIGGER exam_versions_immutable_when_published
    BEFORE UPDATE OR DELETE ON assessment.exam_versions
    FOR EACH ROW EXECUTE FUNCTION assessment.reject_published_snapshot_mutation();
CREATE TRIGGER exam_sections_immutable_when_exam_published
    BEFORE INSERT OR UPDATE OR DELETE ON assessment.exam_sections
    FOR EACH ROW EXECUTE FUNCTION assessment.reject_published_exam_child_mutation();
CREATE TRIGGER exam_items_immutable_when_exam_published
    BEFORE INSERT OR UPDATE OR DELETE ON assessment.exam_items
    FOR EACH ROW EXECUTE FUNCTION assessment.reject_published_exam_child_mutation();
CREATE TRIGGER exam_events_append_only
    BEFORE UPDATE OR DELETE ON assessment.exam_events
    FOR EACH ROW EXECUTE FUNCTION assessment.reject_exam_event_mutation();

ALTER TABLE assessment.proctor_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment.proctor_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE assessment.proctor_policy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment.proctor_policy_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE assessment.exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment.exams FORCE ROW LEVEL SECURITY;
ALTER TABLE assessment.exam_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment.exam_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE assessment.exam_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment.exam_sections FORCE ROW LEVEL SECURITY;
ALTER TABLE assessment.exam_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment.exam_items FORCE ROW LEVEL SECURITY;
ALTER TABLE assessment.assignment_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment.assignment_rules FORCE ROW LEVEL SECURITY;
ALTER TABLE assessment.candidate_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment.candidate_assignments FORCE ROW LEVEL SECURITY;
ALTER TABLE assessment.exam_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment.exam_events FORCE ROW LEVEL SECURITY;

DO $policies$
DECLARE
    protected_table text;
    policy_prefix text;
BEGIN
    FOREACH protected_table IN ARRAY ARRAY[
        'assessment.proctor_policies',
        'assessment.proctor_policy_versions',
        'assessment.exams',
        'assessment.exam_versions',
        'assessment.exam_sections',
        'assessment.exam_items',
        'assessment.assignment_rules',
        'assessment.candidate_assignments',
        'assessment.exam_events'
    ]
    LOOP
        policy_prefix := replace(protected_table, '.', '_');
        EXECUTE format(
            'CREATE POLICY %I ON %s FOR SELECT TO aether_assessment_app USING (authz.current_context_allows_read(tenant_id, %L, %L, %L))',
            policy_prefix || '_signed_read', protected_table,
            'assessment.read', 'assessment.write', protected_table
        );
        EXECUTE format(
            'CREATE POLICY %I ON %s FOR INSERT TO aether_assessment_app WITH CHECK (authz.current_context_allows(tenant_id, %L, %L))',
            policy_prefix || '_signed_insert', protected_table,
            'assessment.write', protected_table
        );
        EXECUTE format(
            'CREATE POLICY %I ON %s FOR UPDATE TO aether_assessment_app USING (authz.current_context_allows(tenant_id, %L, %L)) WITH CHECK (authz.current_context_allows(tenant_id, %L, %L))',
            policy_prefix || '_signed_update', protected_table,
            'assessment.write', protected_table, 'assessment.write', protected_table
        );
        EXECUTE format(
            'CREATE POLICY %I ON %s FOR DELETE TO aether_assessment_app USING (authz.current_context_allows(tenant_id, %L, %L))',
            policy_prefix || '_signed_delete', protected_table,
            'assessment.write', protected_table
        );
        EXECUTE format(
            'CREATE POLICY %I ON %s FOR ALL TO aether_assessment_owner USING (true) WITH CHECK (true)',
            policy_prefix || '_owner_maintenance', protected_table
        );
    END LOOP;
END
$policies$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
    assessment.proctor_policies,
    assessment.proctor_policy_versions,
    assessment.exams,
    assessment.exam_versions,
    assessment.exam_sections,
    assessment.exam_items,
    assessment.assignment_rules,
    assessment.candidate_assignments
TO aether_assessment_app;
GRANT SELECT, INSERT ON TABLE assessment.exam_events TO aether_assessment_app;

RESET ROLE;
