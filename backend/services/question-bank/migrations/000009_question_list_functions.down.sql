SET ROLE aether_question_bank_owner;

DROP FUNCTION IF EXISTS qbank.list_question_versions(uuid, integer, bigint, uuid, text);
DROP FUNCTION IF EXISTS qbank.list_published_questions(integer, timestamptz, uuid, text, text, text);

CREATE FUNCTION qbank.list_published_questions(p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qbank
AS $function$
DECLARE
    response jsonb;
BEGIN
    PERFORM qbank.require_read_context('qbank.questions');
    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
        RAISE EXCEPTION 'question listing limit must be between 1 and 100' USING ERRCODE = '22023';
    END IF;
    SELECT COALESCE(jsonb_agg(qbank.question_response(item.question_id, item.question_version_id)
                              ORDER BY item.published_at DESC, item.question_version_id DESC), '[]'::jsonb)
    INTO response
    FROM (
        SELECT question.id AS question_id, question_version.id AS question_version_id, question_version.published_at
        FROM qbank.questions AS question
        JOIN LATERAL (
            SELECT version_item.id, version_item.published_at
            FROM qbank.question_versions AS version_item
            WHERE version_item.question_id = question.id
              AND version_item.status = 'published'
            ORDER BY version_item.version_number DESC
            LIMIT 1
        ) AS question_version ON true
        WHERE question.lifecycle_state <> 'archived'
        ORDER BY question_version.published_at DESC, question_version.id DESC
        LIMIT p_limit
    ) AS item;
    RETURN response;
END
$function$;

REVOKE ALL ON FUNCTION qbank.list_published_questions(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION qbank.list_published_questions(integer) TO aether_question_bank_app;

RESET ROLE;
