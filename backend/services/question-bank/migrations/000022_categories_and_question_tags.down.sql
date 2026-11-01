SET ROLE aether_question_bank_owner;

-- Restore the version-level tag functions exactly as they were.
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
                    FROM qbank.question_version_tags AS version_tag
                    JOIN qbank.tags AS tag ON tag.id = version_tag.tag_id
                    WHERE version_tag.question_version_id = question_version.id
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
            'audience', question.audience
        ),
        'question_version', qbank.question_version_summary(p_question_version_id)
    )
    FROM qbank.questions AS question
    WHERE question.id = p_question_id
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
        'audience', (SELECT question.audience FROM qbank.questions AS question WHERE question.id = question_version.question_id)
    )
    FROM qbank.question_versions AS question_version
    LEFT JOIN LATERAL (
        SELECT jsonb_agg(
            jsonb_build_object('id', tag.id, 'name', tag.name)
            ORDER BY tag.normalized_name
        ) AS items
        FROM qbank.question_version_tags AS question_version_tag
        JOIN qbank.tags AS tag ON tag.id = question_version_tag.tag_id
        WHERE question_version_tag.question_version_id = question_version.id
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

CREATE OR REPLACE FUNCTION qbank.version_tag_names(p_question_version_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, qbank
AS $function$
    SELECT COALESCE(jsonb_agg(tag.name ORDER BY tag.name), '[]'::jsonb)
    FROM qbank.question_version_tags AS version_tag
    JOIN qbank.tags AS tag ON tag.id = version_tag.tag_id
    WHERE version_tag.question_version_id = p_question_version_id
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

    PERFORM qbank.apply_version_tags(p_question_version_id, p_tags);
    UPDATE qbank.question_versions
    SET version = version + 1
    WHERE id = p_question_version_id;
    SELECT qbank.question_version_summary(p_question_version_id) INTO response;
    RETURN response;
END
$function$;

CREATE OR REPLACE FUNCTION qbank.apply_version_tags(p_question_version_id uuid, p_tags jsonb)
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
    IF p_question_version_id IS NULL OR jsonb_typeof(p_tags) <> 'array' THEN
        RAISE EXCEPTION 'question version and tags array are required' USING ERRCODE = '22023';
    END IF;
    IF jsonb_array_length(p_tags) > 50 THEN
        RAISE EXCEPTION 'a question version may have at most 50 tags' USING ERRCODE = '22023';
    END IF;

    DELETE FROM qbank.question_version_tags
    WHERE question_version_id = p_question_version_id;

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

        INSERT INTO qbank.question_version_tags (question_version_id, tag_id)
        VALUES (p_question_version_id, persisted_tag_id)
        ON CONFLICT DO NOTHING;
    END LOOP;
END
$function$;

DROP FUNCTION qbank.create_question(uuid, uuid, uuid, text, text, text, text, jsonb, integer, integer, text, text, text, jsonb, uuid);
DROP FUNCTION qbank.list_tags(integer);
DROP FUNCTION qbank.set_question_tags(uuid, jsonb);
DROP FUNCTION qbank.set_question_category(uuid, uuid);
DROP FUNCTION qbank.delete_category(uuid, uuid);
DROP FUNCTION qbank.rename_category(uuid, text);
DROP FUNCTION qbank.create_category(uuid, text);
DROP FUNCTION qbank.list_categories();
DROP FUNCTION qbank.apply_question_tags(uuid, jsonb);

-- Tags set since the up migration live only in question_tags and are dropped with it.
DROP TABLE qbank.question_tags;
ALTER TABLE qbank.questions DROP COLUMN category_id;
DROP TABLE qbank.categories;

RESET ROLE;
