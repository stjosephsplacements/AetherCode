-- Categories and question-level tags (ADR-0052).
--
-- A question belongs to one category (Arrays, Strings, DP), then is told apart by
-- difficulty and tags. Category and tags describe the question, not one of its
-- versions, so they can change on a published question without a new version.
--
-- Written to roll out without a gap: every new column has a default and every
-- old function signature still works, so pods running the previous release keep
-- working while this one rolls out. Tags stay readable in question_version_tags
-- (no longer written) until a later migration drops it.
SET ROLE aether_question_bank_owner;

CREATE TABLE qbank.categories (
    id uuid PRIMARY KEY,
    name text NOT NULL CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 80 AND name !~ '[[:cntrl:]]'),
    normalized_name text NOT NULL UNIQUE CHECK (normalized_name = lower(normalized_name)),
    created_by uuid,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- The home of every question that was written before categories existed.
INSERT INTO qbank.categories (id, name, normalized_name) VALUES ('018f4b0d-08f8-7c09-9ba7-efdf9c220c01', 'Uncategorised', 'uncategorised');

ALTER TABLE qbank.questions
    ADD COLUMN category_id uuid NOT NULL DEFAULT '018f4b0d-08f8-7c09-9ba7-efdf9c220c01' REFERENCES qbank.categories (id) ON DELETE RESTRICT;
CREATE INDEX questions_category_idx ON qbank.questions (category_id) WHERE deleted_at IS NULL;

CREATE TABLE qbank.question_tags (
    question_id uuid NOT NULL REFERENCES qbank.questions (id) ON DELETE CASCADE,
    tag_id uuid NOT NULL REFERENCES qbank.tags (id) ON DELETE RESTRICT,
    PRIMARY KEY (question_id, tag_id)
);
CREATE INDEX question_tags_tag_idx ON qbank.question_tags (tag_id, question_id);

-- Each question keeps the tags of its newest version.
INSERT INTO qbank.question_tags (question_id, tag_id)
SELECT latest.question_id, version_tag.tag_id
FROM (
    SELECT DISTINCT ON (question_id) id, question_id
    FROM qbank.question_versions
    ORDER BY question_id, version_number DESC
) AS latest
JOIN qbank.question_version_tags AS version_tag ON version_tag.question_version_id = latest.id
ON CONFLICT DO NOTHING;

ALTER TABLE qbank.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE qbank.categories FORCE ROW LEVEL SECURITY;
ALTER TABLE qbank.question_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE qbank.question_tags FORCE ROW LEVEL SECURITY;

DO $policies$
DECLARE
    protected_table text;
    policy_prefix text;
BEGIN
    FOREACH protected_table IN ARRAY ARRAY['qbank.categories', 'qbank.question_tags']
    LOOP
        policy_prefix := replace(protected_table, '.', '_');
        EXECUTE format(
            'CREATE POLICY %I ON %s FOR SELECT TO aether_question_bank_app USING (authz.current_global_context_allows_read(%L, %L, %L))',
            policy_prefix || '_signed_read', protected_table, 'qbank.read', 'qbank.write', protected_table
        );
        EXECUTE format(
            'CREATE POLICY %I ON %s FOR INSERT TO aether_question_bank_app WITH CHECK (authz.current_global_context_allows(%L, %L, true))',
            policy_prefix || '_signed_insert', protected_table, 'qbank.write', protected_table
        );
        EXECUTE format(
            'CREATE POLICY %I ON %s FOR UPDATE TO aether_question_bank_app USING (authz.current_global_context_allows(%L, %L, true)) WITH CHECK (authz.current_global_context_allows(%L, %L, true))',
            policy_prefix || '_signed_update', protected_table, 'qbank.write', protected_table, 'qbank.write', protected_table
        );
        EXECUTE format(
            'CREATE POLICY %I ON %s FOR DELETE TO aether_question_bank_app USING (authz.current_global_context_allows(%L, %L, true))',
            policy_prefix || '_signed_delete', protected_table, 'qbank.write', protected_table
        );
        EXECUTE format(
            'CREATE POLICY %I ON %s FOR ALL TO aether_question_bank_owner USING (true) WITH CHECK (true)',
            policy_prefix || '_owner_maintenance', protected_table
        );
    END LOOP;
END
$policies$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE qbank.categories, qbank.question_tags TO aether_question_bank_app;

-- Tags move to the question.
CREATE FUNCTION qbank.apply_question_tags(p_question_id uuid, p_tags jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qbank
AS $function$
DECLARE
    tag_item jsonb;
    supplied_tag_id uuid;
    persisted_tag_id uuid;
    tag_name text;
BEGIN
    IF p_question_id IS NULL OR jsonb_typeof(p_tags) <> 'array' THEN
        RAISE EXCEPTION 'question and tags array are required' USING ERRCODE = '22023';
    END IF;
    IF jsonb_array_length(p_tags) > 50 THEN
        RAISE EXCEPTION 'a question may have at most 50 tags' USING ERRCODE = '22023';
    END IF;

    DELETE FROM qbank.question_tags
    WHERE question_id = p_question_id;

    FOR tag_item IN SELECT value FROM jsonb_array_elements(p_tags) LOOP
        IF jsonb_typeof(tag_item) <> 'object' THEN
            RAISE EXCEPTION 'tag must be an object' USING ERRCODE = '22023';
        END IF;
        BEGIN
            supplied_tag_id := (tag_item ->> 'id')::uuid;
        EXCEPTION WHEN invalid_text_representation THEN
            RAISE EXCEPTION 'tag identifier is invalid' USING ERRCODE = '22023';
        END;
        tag_name := btrim(tag_item ->> 'name');
        IF supplied_tag_id IS NULL
           OR tag_name IS NULL
           OR char_length(tag_name) NOT BETWEEN 1 AND 80
           OR tag_name <> lower(tag_name)
           OR tag_name ~ '[[:cntrl:]]' THEN
            RAISE EXCEPTION 'tag is invalid' USING ERRCODE = '22023';
        END IF;

        INSERT INTO qbank.tags (id, name, normalized_name)
        VALUES (supplied_tag_id, tag_name, tag_name)
        ON CONFLICT (normalized_name) DO UPDATE
        SET name = qbank.tags.name
        RETURNING id INTO persisted_tag_id;

        INSERT INTO qbank.question_tags (question_id, tag_id)
        VALUES (p_question_id, persisted_tag_id)
        ON CONFLICT DO NOTHING;
    END LOOP;
END
$function$;

CREATE OR REPLACE FUNCTION qbank.apply_version_tags(p_question_version_id uuid, p_tags jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qbank
AS $function$
DECLARE
    target_question_id uuid;
BEGIN
    IF p_question_version_id IS NULL OR jsonb_typeof(p_tags) <> 'array' THEN
        RAISE EXCEPTION 'question version and tags array are required' USING ERRCODE = '22023';
    END IF;
    -- Tags belong to the question now (ADR-0052). A version payload that names none
    -- leaves them alone, so a new draft cannot wipe them; clearing them is set_question_tags.
    IF jsonb_array_length(p_tags) = 0 THEN
        RETURN;
    END IF;
    SELECT question_id INTO target_question_id FROM qbank.question_versions WHERE id = p_question_version_id;
    IF target_question_id IS NULL THEN
        RAISE EXCEPTION 'question version was not found' USING ERRCODE = 'P0002';
    END IF;
    PERFORM qbank.apply_question_tags(target_question_id, p_tags);
END
$function$;

CREATE OR REPLACE FUNCTION qbank.replace_question_version_tags(
    p_question_version_id uuid,
    p_expected_question_version bigint,
    p_tags jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qbank, authz, app
AS $function$
DECLARE
    version_row qbank.question_versions%ROWTYPE;
    response jsonb;
BEGIN
    PERFORM qbank.require_write_context('qbank.question_version_tags');
    IF p_question_version_id IS NULL
       OR p_expected_question_version <= 0
       OR jsonb_typeof(p_tags) <> 'array' THEN
        RAISE EXCEPTION 'question version tag inputs are invalid' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO version_row
    FROM qbank.question_versions
    WHERE id = p_question_version_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'question version was not found' USING ERRCODE = 'P0002';
    END IF;
    IF version_row.status <> 'draft' THEN
        RAISE EXCEPTION 'published question versions cannot change tags' USING ERRCODE = '55000';
    END IF;
    IF version_row.version <> p_expected_question_version THEN
        RAISE EXCEPTION 'question version revision is stale' USING ERRCODE = '40001';
    END IF;

    PERFORM qbank.apply_question_tags(version_row.question_id, p_tags);
    UPDATE qbank.question_versions
    SET version = version + 1
    WHERE id = p_question_version_id;
    SELECT qbank.question_version_summary(p_question_version_id) INTO response;
    RETURN response;
END
$function$;

CREATE OR REPLACE FUNCTION qbank.version_tag_names(p_question_version_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, qbank
AS $function$
    SELECT COALESCE(jsonb_agg(tag.name ORDER BY tag.name), '[]'::jsonb)
    FROM qbank.question_versions AS version_row
    JOIN qbank.question_tags AS question_tag ON question_tag.question_id = version_row.question_id
    JOIN qbank.tags AS tag ON tag.id = question_tag.tag_id
    WHERE version_row.id = p_question_version_id
$function$;

CREATE OR REPLACE FUNCTION qbank.question_version_summary(p_question_version_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, qbank
AS $function$
    SELECT jsonb_build_object(
        'id', question_version.id,
        'question_id', question_version.question_id,
        'version_number', question_version.version_number,
        'title', question_version.title,
        'prompt_markdown', question_version.prompt_markdown,
        'difficulty', question_version.difficulty,
        'supported_languages', question_version.supported_languages,
        'time_limit_ms', question_version.time_limit_ms,
        'memory_limit_kib', question_version.memory_limit_kib,
        'status', question_version.status,
        'published_at', question_version.published_at,
        'created_at', question_version.created_at,
        'version', question_version.version,
        'tags', COALESCE(tags.items, '[]'::jsonb),
        'sample_test_case_count', COALESCE(manifests.sample_test_case_count, 0),
        'hidden_test_case_count', COALESCE(manifests.hidden_test_case_count, 0),
        'asset_count', COALESCE(assets.asset_count, 0),
        'kind', question_version.kind,
        'choices', question_version.choices,
        'correct_choices', to_jsonb(question_version.correct_choices),
        'multiple_choice', question_version.multiple_choice,
        'review_requested_at', question_version.review_requested_at,
        'review_requested_by', question_version.review_requested_by,
        'assigned_reviewer_id', question_version.assigned_reviewer_id,
        'audience', (SELECT question.audience FROM qbank.questions AS question WHERE question.id = question_version.question_id),
        'category_id', (SELECT question.category_id FROM qbank.questions AS question WHERE question.id = question_version.question_id),
        'category', (
            SELECT jsonb_build_object('id', category.id, 'name', category.name)
            FROM qbank.questions AS question JOIN qbank.categories AS category ON category.id = question.category_id
            WHERE question.id = question_version.question_id
        )
    )
    FROM qbank.question_versions AS question_version
    LEFT JOIN LATERAL (
        SELECT jsonb_agg(
            jsonb_build_object('id', tag.id, 'name', tag.name)
            ORDER BY tag.normalized_name
        ) AS items
        FROM qbank.question_tags AS question_tag
        JOIN qbank.tags AS tag ON tag.id = question_tag.tag_id
        WHERE question_tag.question_id = question_version.question_id
    ) AS tags ON true
    LEFT JOIN LATERAL (
        SELECT
            COALESCE(sum(test_manifest.test_case_count) FILTER (WHERE test_manifest.manifest_kind = 'sample'), 0)::integer
                AS sample_test_case_count,
            COALESCE(sum(test_manifest.test_case_count) FILTER (WHERE test_manifest.manifest_kind = 'hidden'), 0)::integer
                AS hidden_test_case_count
        FROM qbank.test_case_manifests AS test_manifest
        WHERE test_manifest.question_version_id = question_version.id
    ) AS manifests ON true
    LEFT JOIN LATERAL (
        SELECT count(*)::integer AS asset_count
        FROM qbank.question_assets AS asset
        WHERE asset.question_version_id = question_version.id
    ) AS assets ON true
    WHERE question_version.id = p_question_version_id
$function$;

CREATE OR REPLACE FUNCTION qbank.question_response(p_question_id uuid, p_question_version_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, qbank
AS $function$
    SELECT jsonb_build_object(
        'question', jsonb_build_object(
            'id', question.id,
            'slug', question.slug,
            'lifecycle_state', question.lifecycle_state,
            'created_at', question.created_at,
            'archived_at', question.archived_at,
            'version', question.version,
            'audience', question.audience,
            'category_id', question.category_id,
            'category', (SELECT jsonb_build_object('id', category.id, 'name', category.name) FROM qbank.categories AS category WHERE category.id = question.category_id)
        ),
        'question_version', qbank.question_version_summary(p_question_version_id)
    )
    FROM qbank.questions AS question
    WHERE question.id = p_question_id
$function$;

CREATE OR REPLACE FUNCTION qbank.list_published_questions(
    p_limit integer,
    p_cursor_published_at timestamptz,
    p_cursor_id uuid,
    p_difficulty text,
    p_tag text,
    p_language text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qbank
AS $function$
DECLARE
    response jsonb;
BEGIN
    PERFORM qbank.require_read_context('qbank.questions');
    -- 101 accommodates the caller's limit+1 probe for next-page detection.
    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 101 THEN
        RAISE EXCEPTION 'question listing limit must be between 1 and 100' USING ERRCODE = '22023';
    END IF;
    IF (p_cursor_published_at IS NULL) <> (p_cursor_id IS NULL) THEN
        RAISE EXCEPTION 'question listing cursor must supply both parts' USING ERRCODE = '22023';
    END IF;

    SELECT COALESCE(jsonb_agg(qbank.question_response(item.question_id, item.question_version_id)
                              ORDER BY item.published_at DESC, item.question_version_id DESC), '[]'::jsonb)
    INTO response
    FROM (
        SELECT question.id AS question_id,
               question_version.id AS question_version_id,
               question_version.published_at
        FROM qbank.questions AS question
        JOIN LATERAL (
            SELECT version_item.id, version_item.published_at, version_item.difficulty,
                   version_item.supported_languages
            FROM qbank.question_versions AS version_item
            WHERE version_item.question_id = question.id
              AND version_item.status = 'published'
            ORDER BY version_item.version_number DESC
            LIMIT 1
        ) AS question_version ON true
        WHERE question.lifecycle_state <> 'archived'
          AND (p_difficulty IS NULL OR question_version.difficulty = p_difficulty)
          AND (p_language IS NULL OR question_version.supported_languages ? p_language)
          AND (
                p_tag IS NULL
                OR EXISTS (
                    SELECT 1
                    FROM qbank.question_tags AS question_tag
                    JOIN qbank.tags AS tag ON tag.id = question_tag.tag_id
                    WHERE question_tag.question_id = question.id
                      AND tag.name = p_tag
                )
              )
          AND (
                p_cursor_published_at IS NULL
                OR (question_version.published_at, question_version.id) < (p_cursor_published_at, p_cursor_id)
              )
        ORDER BY question_version.published_at DESC, question_version.id DESC
        LIMIT p_limit
    ) AS item;

    RETURN response;
END
$function$;

-- Categories. Adding one is open to every author (qbank.categories); renaming,
-- merging and deleting go through qbank.category_management, which the User
-- service grants to administrators only.
CREATE FUNCTION qbank.list_categories()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, qbank, authz, app
AS $function$
BEGIN
    PERFORM qbank.require_read_context('qbank.categories');
    RETURN COALESCE((
        SELECT jsonb_agg(
            jsonb_build_object('id', category.id, 'name', category.name, 'question_count', COALESCE(counts.total, 0))
            ORDER BY (category.id = '018f4b0d-08f8-7c09-9ba7-efdf9c220c01'::uuid), category.normalized_name
        )
        FROM qbank.categories AS category
        LEFT JOIN LATERAL (
            SELECT count(*)::integer AS total
            FROM qbank.questions AS question
            WHERE question.category_id = category.id AND question.deleted_at IS NULL AND question.lifecycle_state <> 'archived'
        ) AS counts ON true
    ), '[]'::jsonb);
END
$function$;

CREATE FUNCTION qbank.create_category(p_id uuid, p_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qbank, authz, app
AS $function$
DECLARE
    actor_id uuid;
    cleaned text;
    inserted integer;
    found_category qbank.categories%ROWTYPE;
BEGIN
    actor_id := qbank.require_write_context('qbank.categories');
    cleaned := btrim(regexp_replace(COALESCE(p_name, ''), '[[:space:]]+', ' ', 'g'));
    IF p_id IS NULL OR char_length(cleaned) NOT BETWEEN 1 AND 80 OR cleaned ~ '[[:cntrl:]]' THEN
        RAISE EXCEPTION 'category name must be 1 to 80 characters' USING ERRCODE = '22023';
    END IF;
    -- Adding a name that exists (in any letter case) returns the existing category, so two authors never make duplicates.
    INSERT INTO qbank.categories (id, name, normalized_name, created_by)
    VALUES (p_id, cleaned, lower(cleaned), actor_id)
    ON CONFLICT (normalized_name) DO NOTHING;
    GET DIAGNOSTICS inserted = ROW_COUNT;
    SELECT * INTO found_category FROM qbank.categories WHERE normalized_name = lower(cleaned);
    RETURN jsonb_build_object('id', found_category.id, 'name', found_category.name, 'created', inserted = 1);
END
$function$;

CREATE FUNCTION qbank.rename_category(p_category_id uuid, p_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qbank, authz, app
AS $function$
DECLARE
    cleaned text;
BEGIN
    PERFORM qbank.require_write_context('qbank.category_management');
    cleaned := btrim(regexp_replace(COALESCE(p_name, ''), '[[:space:]]+', ' ', 'g'));
    IF p_category_id IS NULL OR char_length(cleaned) NOT BETWEEN 1 AND 80 OR cleaned ~ '[[:cntrl:]]' THEN
        RAISE EXCEPTION 'category name must be 1 to 80 characters' USING ERRCODE = '22023';
    END IF;
    IF p_category_id = '018f4b0d-08f8-7c09-9ba7-efdf9c220c01'::uuid THEN
        RAISE EXCEPTION 'category Uncategorised is built in and cannot be renamed' USING ERRCODE = '55000';
    END IF;
    IF EXISTS (SELECT 1 FROM qbank.categories WHERE normalized_name = lower(cleaned) AND id <> p_category_id) THEN
        RAISE EXCEPTION 'category name is already in use' USING ERRCODE = '55000';
    END IF;
    UPDATE qbank.categories SET name = cleaned, normalized_name = lower(cleaned) WHERE id = p_category_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'category was not found' USING ERRCODE = 'P0002';
    END IF;
    RETURN jsonb_build_object('id', p_category_id, 'name', cleaned);
END
$function$;

-- Deleting a category files its questions under p_move_to, or Uncategorised.
CREATE FUNCTION qbank.delete_category(p_category_id uuid, p_move_to uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qbank, authz, app
AS $function$
DECLARE
    target uuid := COALESCE(p_move_to, '018f4b0d-08f8-7c09-9ba7-efdf9c220c01'::uuid);
    moved integer;
BEGIN
    PERFORM qbank.require_write_context('qbank.category_management');
    IF p_category_id IS NULL THEN
        RAISE EXCEPTION 'category is required' USING ERRCODE = '22023';
    END IF;
    IF p_category_id = '018f4b0d-08f8-7c09-9ba7-efdf9c220c01'::uuid THEN
        RAISE EXCEPTION 'category Uncategorised is built in and cannot be deleted' USING ERRCODE = '55000';
    END IF;
    IF target = p_category_id THEN
        RAISE EXCEPTION 'category cannot be merged into itself' USING ERRCODE = '55000';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM qbank.categories WHERE id = p_category_id) THEN
        RAISE EXCEPTION 'category was not found' USING ERRCODE = 'P0002';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM qbank.categories WHERE id = target) THEN
        RAISE EXCEPTION 'category to move questions into was not found' USING ERRCODE = 'P0002';
    END IF;
    UPDATE qbank.questions SET category_id = target WHERE category_id = p_category_id;
    GET DIAGNOSTICS moved = ROW_COUNT;
    DELETE FROM qbank.categories WHERE id = p_category_id;
    RETURN jsonb_build_object('deleted', p_category_id, 'moved_to', target, 'moved', moved);
END
$function$;

CREATE FUNCTION qbank.set_question_category(p_question_id uuid, p_category_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qbank, authz, app
AS $function$
BEGIN
    PERFORM qbank.require_write_context('qbank.questions');
    IF p_question_id IS NULL OR p_category_id IS NULL THEN
        RAISE EXCEPTION 'question and category are required' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM qbank.categories WHERE id = p_category_id) THEN
        RAISE EXCEPTION 'category was not found' USING ERRCODE = 'P0002';
    END IF;
    UPDATE qbank.questions SET category_id = p_category_id WHERE id = p_question_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'question was not found' USING ERRCODE = 'P0002';
    END IF;
    RETURN jsonb_build_object('category_id', p_category_id);
END
$function$;

CREATE FUNCTION qbank.set_question_tags(p_question_id uuid, p_tags jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qbank, authz, app
AS $function$
BEGIN
    PERFORM qbank.require_write_context('qbank.questions');
    IF NOT EXISTS (SELECT 1 FROM qbank.questions WHERE id = p_question_id AND deleted_at IS NULL) THEN
        RAISE EXCEPTION 'question was not found' USING ERRCODE = 'P0002';
    END IF;
    PERFORM qbank.apply_question_tags(p_question_id, p_tags);
    RETURN jsonb_build_object('tags', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', tag.id, 'name', tag.name) ORDER BY tag.normalized_name)
        FROM qbank.question_tags AS question_tag JOIN qbank.tags AS tag ON tag.id = question_tag.tag_id
        WHERE question_tag.question_id = p_question_id
    ), '[]'::jsonb));
END
$function$;

-- The tags in use, most used first, for suggestions while typing.
CREATE FUNCTION qbank.list_tags(p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, qbank, authz, app
AS $function$
BEGIN
    PERFORM qbank.require_read_context('qbank.tags');
    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
        RAISE EXCEPTION 'tag listing limit must be between 1 and 500' USING ERRCODE = '22023';
    END IF;
    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object('name', tag.name, 'count', used.total) ORDER BY used.total DESC, tag.normalized_name)
        FROM (
            SELECT question_tag.tag_id, count(*)::integer AS total
            FROM qbank.question_tags AS question_tag
            GROUP BY question_tag.tag_id
            ORDER BY count(*) DESC
            LIMIT p_limit
        ) AS used
        JOIN qbank.tags AS tag ON tag.id = used.tag_id
    ), '[]'::jsonb);
END
$function$;

CREATE FUNCTION qbank.create_question(
    p_question_id uuid,
    p_question_version_id uuid,
    p_event_id uuid,
    p_slug text,
    p_title text,
    p_prompt_markdown text,
    p_difficulty text,
    p_supported_languages jsonb,
    p_time_limit_ms integer,
    p_memory_limit_kib integer,
    p_evaluation_bundle_object_key text,
    p_evaluation_bundle_checksum text,
    p_encryption_key_reference text,
    p_tags jsonb,
    p_category_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qbank
AS $function$
DECLARE
    response jsonb;
BEGIN
    -- The original does the work and its own authorization checks; the category is set in the same transaction.
    response := qbank.create_question(
        p_question_id, p_question_version_id, p_event_id, p_slug, p_title, p_prompt_markdown, p_difficulty,
        p_supported_languages, p_time_limit_ms, p_memory_limit_kib, p_evaluation_bundle_object_key,
        p_evaluation_bundle_checksum, p_encryption_key_reference, p_tags
    );
    IF p_category_id IS NOT NULL THEN
        PERFORM qbank.set_question_category(p_question_id, p_category_id);
        response := qbank.question_response(p_question_id, p_question_version_id);
    END IF;
    RETURN response;
END
$function$;

REVOKE ALL ON FUNCTION qbank.apply_question_tags(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION qbank.list_categories() FROM PUBLIC;
REVOKE ALL ON FUNCTION qbank.create_category(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION qbank.rename_category(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION qbank.delete_category(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION qbank.set_question_category(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION qbank.set_question_tags(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION qbank.list_tags(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION qbank.create_question(uuid, uuid, uuid, text, text, text, text, jsonb, integer, integer, text, text, text, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION qbank.list_categories() TO aether_question_bank_app;
GRANT EXECUTE ON FUNCTION qbank.create_category(uuid, text) TO aether_question_bank_app;
GRANT EXECUTE ON FUNCTION qbank.rename_category(uuid, text) TO aether_question_bank_app;
GRANT EXECUTE ON FUNCTION qbank.delete_category(uuid, uuid) TO aether_question_bank_app;
GRANT EXECUTE ON FUNCTION qbank.set_question_category(uuid, uuid) TO aether_question_bank_app;
GRANT EXECUTE ON FUNCTION qbank.set_question_tags(uuid, jsonb) TO aether_question_bank_app;
GRANT EXECUTE ON FUNCTION qbank.list_tags(integer) TO aether_question_bank_app;
GRANT EXECUTE ON FUNCTION qbank.create_question(uuid, uuid, uuid, text, text, text, text, jsonb, integer, integer, text, text, text, jsonb, uuid) TO aether_question_bank_app;

RESET ROLE;
