SET ROLE aether_question_bank_owner;

CREATE TABLE qbank.questions (
    id uuid PRIMARY KEY,
    slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
    lifecycle_state text NOT NULL DEFAULT 'draft'
        CHECK (lifecycle_state IN ('draft', 'published', 'archived')),
    created_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    archived_at timestamptz,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    CHECK ((lifecycle_state = 'archived') = (archived_at IS NOT NULL))
);

CREATE TABLE qbank.question_versions (
    id uuid PRIMARY KEY,
    question_id uuid NOT NULL REFERENCES qbank.questions (id) ON DELETE RESTRICT,
    version_number integer NOT NULL CHECK (version_number > 0),
    title text NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
    prompt_markdown text NOT NULL CHECK (length(prompt_markdown) > 0),
    difficulty text NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
    supported_languages jsonb NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(supported_languages) = 'array'),
    time_limit_ms integer NOT NULL CHECK (time_limit_ms BETWEEN 50 AND 600000),
    memory_limit_kib integer NOT NULL CHECK (memory_limit_kib BETWEEN 1024 AND 4194304),
    evaluation_bundle_object_key text NOT NULL CHECK (length(evaluation_bundle_object_key) > 0),
    evaluation_bundle_checksum char(64) NOT NULL
        CHECK (evaluation_bundle_checksum ~* '^[0-9a-f]{64}$'),
    encryption_key_reference text NOT NULL CHECK (length(encryption_key_reference) > 0),
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'retired')),
    published_at timestamptz,
    created_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (question_id, version_number),
    CHECK (
        (status = 'draft' AND published_at IS NULL)
        OR (status IN ('published', 'retired') AND published_at IS NOT NULL)
    )
);

CREATE INDEX question_versions_question_idx
    ON qbank.question_versions (question_id, version_number DESC);
CREATE INDEX question_versions_published_idx
    ON qbank.question_versions (difficulty, published_at DESC)
    WHERE status = 'published';

CREATE TABLE qbank.test_case_manifests (
    id uuid PRIMARY KEY,
    question_version_id uuid NOT NULL REFERENCES qbank.question_versions (id) ON DELETE RESTRICT,
    manifest_kind text NOT NULL CHECK (manifest_kind IN ('sample', 'hidden')),
    object_key text NOT NULL CHECK (length(object_key) > 0),
    checksum char(64) NOT NULL CHECK (checksum ~* '^[0-9a-f]{64}$'),
    encryption_key_reference text NOT NULL CHECK (length(encryption_key_reference) > 0),
    test_case_count integer NOT NULL CHECK (test_case_count > 0),
    created_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (question_version_id, manifest_kind)
);

CREATE TABLE qbank.question_assets (
    id uuid PRIMARY KEY,
    question_version_id uuid NOT NULL REFERENCES qbank.question_versions (id) ON DELETE RESTRICT,
    asset_kind text NOT NULL CHECK (asset_kind IN ('attachment', 'starter_code', 'reference_solution')),
    object_key text NOT NULL CHECK (length(object_key) > 0),
    checksum char(64) NOT NULL CHECK (checksum ~* '^[0-9a-f]{64}$'),
    encryption_key_reference text NOT NULL CHECK (length(encryption_key_reference) > 0),
    content_type text NOT NULL CHECK (length(content_type) BETWEEN 1 AND 180),
    byte_size bigint NOT NULL CHECK (byte_size > 0),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (question_version_id, asset_kind, object_key)
);

CREATE TABLE qbank.tags (
    id uuid PRIMARY KEY,
    name text NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 80),
    normalized_name text NOT NULL UNIQUE CHECK (normalized_name = lower(normalized_name)),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE qbank.question_version_tags (
    question_version_id uuid NOT NULL REFERENCES qbank.question_versions (id) ON DELETE RESTRICT,
    tag_id uuid NOT NULL REFERENCES qbank.tags (id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (question_version_id, tag_id)
);

CREATE INDEX question_version_tags_tag_idx ON qbank.question_version_tags (tag_id, question_version_id);

CREATE FUNCTION qbank.reject_published_question_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, qbank
AS $$
BEGIN
    IF TG_OP = 'DELETE' AND OLD.published_at IS NOT NULL THEN
        RAISE EXCEPTION 'published question version % is immutable', OLD.id
            USING ERRCODE = '55000';
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.published_at IS NOT NULL THEN
        RAISE EXCEPTION 'published question version % is immutable', OLD.id
            USING ERRCODE = '55000';
    END IF;

    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER question_versions_immutable_when_published
    BEFORE UPDATE OR DELETE ON qbank.question_versions
    FOR EACH ROW EXECUTE FUNCTION qbank.reject_published_question_version_mutation();

CREATE FUNCTION qbank.reject_published_question_child_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, qbank
AS $$
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') AND EXISTS (
        SELECT 1
        FROM qbank.question_versions question_version
        WHERE question_version.id = OLD.question_version_id
          AND question_version.published_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'content attached to published question version % is immutable', OLD.question_version_id
            USING ERRCODE = '55000';
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE') AND EXISTS (
        SELECT 1
        FROM qbank.question_versions question_version
        WHERE question_version.id = NEW.question_version_id
          AND question_version.published_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'content cannot be attached to published question version %', NEW.question_version_id
            USING ERRCODE = '55000';
    END IF;

    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE FUNCTION qbank.reject_hidden_manifest_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, qbank
AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND (OLD.manifest_kind = 'hidden' OR NEW.manifest_kind = 'hidden') THEN
        RAISE EXCEPTION 'hidden test manifest % is immutable', OLD.id
            USING ERRCODE = '55000';
    END IF;

    IF TG_OP = 'DELETE' AND OLD.manifest_kind = 'hidden' THEN
        RAISE EXCEPTION 'hidden test manifest % is immutable', OLD.id
            USING ERRCODE = '55000';
    END IF;

    IF TG_OP IN ('UPDATE', 'DELETE') AND EXISTS (
        SELECT 1
        FROM qbank.question_versions question_version
        WHERE question_version.id = OLD.question_version_id
          AND question_version.published_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'test manifest for published question version % is immutable', OLD.question_version_id
            USING ERRCODE = '55000';
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE') AND EXISTS (
        SELECT 1
        FROM qbank.question_versions question_version
        WHERE question_version.id = NEW.question_version_id
          AND question_version.published_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'test manifest cannot be attached to published question version %', NEW.question_version_id
            USING ERRCODE = '55000';
    END IF;

    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER question_assets_immutable_with_published_version
    BEFORE INSERT OR UPDATE OR DELETE ON qbank.question_assets
    FOR EACH ROW EXECUTE FUNCTION qbank.reject_published_question_child_mutation();

CREATE TRIGGER question_version_tags_immutable_with_published_version
    BEFORE INSERT OR UPDATE OR DELETE ON qbank.question_version_tags
    FOR EACH ROW EXECUTE FUNCTION qbank.reject_published_question_child_mutation();

CREATE TRIGGER hidden_test_manifests_immutable
    BEFORE INSERT OR UPDATE OR DELETE ON qbank.test_case_manifests
    FOR EACH ROW EXECUTE FUNCTION qbank.reject_hidden_manifest_mutation();

ALTER TABLE qbank.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE qbank.questions FORCE ROW LEVEL SECURITY;
ALTER TABLE qbank.question_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE qbank.question_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE qbank.test_case_manifests ENABLE ROW LEVEL SECURITY;
ALTER TABLE qbank.test_case_manifests FORCE ROW LEVEL SECURITY;
ALTER TABLE qbank.question_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE qbank.question_assets FORCE ROW LEVEL SECURITY;
ALTER TABLE qbank.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE qbank.tags FORCE ROW LEVEL SECURITY;
ALTER TABLE qbank.question_version_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE qbank.question_version_tags FORCE ROW LEVEL SECURITY;

DO $policies$
DECLARE
    protected_table text;
    policy_prefix text;
BEGIN
    FOREACH protected_table IN ARRAY ARRAY[
        'qbank.questions',
        'qbank.question_versions',
        'qbank.test_case_manifests',
        'qbank.question_assets',
        'qbank.tags',
        'qbank.question_version_tags'
    ]
    LOOP
        policy_prefix := replace(protected_table, '.', '_');
        EXECUTE format(
            'CREATE POLICY %I ON %s FOR SELECT TO aether_question_bank_app USING (authz.current_global_context_allows_read(%L, %L, %L))',
            policy_prefix || '_signed_read', protected_table,
            'qbank.read', 'qbank.write', protected_table
        );
        EXECUTE format(
            'CREATE POLICY %I ON %s FOR INSERT TO aether_question_bank_app WITH CHECK (authz.current_global_context_allows(%L, %L, true))',
            policy_prefix || '_signed_insert', protected_table,
            'qbank.write', protected_table
        );
        EXECUTE format(
            'CREATE POLICY %I ON %s FOR UPDATE TO aether_question_bank_app USING (authz.current_global_context_allows(%L, %L, true)) WITH CHECK (authz.current_global_context_allows(%L, %L, true))',
            policy_prefix || '_signed_update', protected_table,
            'qbank.write', protected_table, 'qbank.write', protected_table
        );
        EXECUTE format(
            'CREATE POLICY %I ON %s FOR DELETE TO aether_question_bank_app USING (authz.current_global_context_allows(%L, %L, true))',
            policy_prefix || '_signed_delete', protected_table,
            'qbank.write', protected_table
        );
        EXECUTE format(
            'CREATE POLICY %I ON %s FOR ALL TO aether_question_bank_owner USING (true) WITH CHECK (true)',
            policy_prefix || '_owner_maintenance', protected_table
        );
    END LOOP;
END
$policies$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
    qbank.questions,
    qbank.question_versions,
    qbank.test_case_manifests,
    qbank.question_assets,
    qbank.tags,
    qbank.question_version_tags
TO aether_question_bank_app;

RESET ROLE;
