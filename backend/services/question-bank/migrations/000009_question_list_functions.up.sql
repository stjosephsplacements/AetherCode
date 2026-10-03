-- Replace the limit-only question listing with a cursor-aware one and add
-- version listing. Question Bank content is tenant-global, so these are
-- Class B: require_read_context plus the existing RLS policies are sufficient
-- and there is no per-actor ownership to bind.
SET ROLE aether_question_bank_owner;

DROP FUNCTION IF EXISTS qbank.list_published_questions(integer);

CREATE FUNCTION qbank.list_published_questions(
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

CREATE FUNCTION qbank.list_question_versions(
    p_question_id uuid,
    p_limit integer,
    p_cursor_version_number bigint,
    p_cursor_id uuid,
    p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qbank
AS $function$
DECLARE
    response jsonb;
BEGIN
    PERFORM qbank.require_read_context('qbank.question_versions');
    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 101 THEN
        RAISE EXCEPTION 'question version listing limit must be between 1 and 100' USING ERRCODE = '22023';
    END IF;
    IF (p_cursor_version_number IS NULL) <> (p_cursor_id IS NULL) THEN
        RAISE EXCEPTION 'question version listing cursor must supply both parts' USING ERRCODE = '22023';
    END IF;

    SELECT COALESCE(jsonb_agg(qbank.question_version_summary(item.id)
                              ORDER BY item.version_number DESC, item.id DESC), '[]'::jsonb)
    INTO response
    FROM (
        SELECT version_item.id, version_item.version_number
        FROM qbank.question_versions AS version_item
        WHERE version_item.question_id = p_question_id
          AND version_item.deleted_at IS NULL
          AND (p_status IS NULL OR version_item.status = p_status)
          AND (
                p_cursor_version_number IS NULL
                OR (version_item.version_number, version_item.id) < (p_cursor_version_number, p_cursor_id)
              )
        ORDER BY version_item.version_number DESC, version_item.id DESC
        LIMIT p_limit
    ) AS item;

    RETURN response;
END
$function$;

REVOKE ALL ON FUNCTION
    qbank.list_published_questions(integer, timestamptz, uuid, text, text, text),
    qbank.list_question_versions(uuid, integer, bigint, uuid, text)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
    qbank.list_published_questions(integer, timestamptz, uuid, text, text, text),
    qbank.list_question_versions(uuid, integer, bigint, uuid, text)
    TO aether_question_bank_app;

RESET ROLE;
