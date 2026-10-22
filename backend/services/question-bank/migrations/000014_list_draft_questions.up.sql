SET ROLE aether_question_bank_owner;

-- An author's questions whose latest version is still a draft, newest first,
-- so the staff web UI can list work in progress next to published questions.
CREATE FUNCTION qbank.list_draft_questions(p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qbank, authz, app
AS $function$
DECLARE
    author uuid;
    response jsonb;
BEGIN
    PERFORM qbank.require_read_context('qbank.questions');
    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
        RAISE EXCEPTION 'question listing limit must be between 1 and 100' USING ERRCODE = '22023';
    END IF;
    SELECT context.actor_id INTO author
    FROM authz.request_contexts AS context
    WHERE context.context_id = app.current_context_id()
      AND context.backend_pid = pg_backend_pid()
      AND context.transaction_id = txid_current();

    SELECT COALESCE(jsonb_agg(qbank.question_response(item.question_id, item.question_version_id)
                              ORDER BY item.created_at DESC, item.question_version_id DESC), '[]'::jsonb)
    INTO response
    FROM (
        SELECT question.id AS question_id, latest.id AS question_version_id, latest.created_at
        FROM qbank.questions AS question
        JOIN LATERAL (
            SELECT version_item.id, version_item.status, version_item.created_by, version_item.created_at
            FROM qbank.question_versions AS version_item
            WHERE version_item.question_id = question.id
              AND version_item.deleted_at IS NULL
            ORDER BY version_item.version_number DESC
            LIMIT 1
        ) AS latest ON true
        WHERE question.lifecycle_state <> 'archived'
          AND question.deleted_at IS NULL
          AND latest.status = 'draft'
          AND latest.created_by = author
        ORDER BY latest.created_at DESC, latest.id DESC
        LIMIT p_limit
    ) AS item;
    RETURN response;
END
$function$;

REVOKE ALL ON FUNCTION qbank.list_draft_questions(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION qbank.list_draft_questions(integer) TO aether_question_bank_app;

RESET ROLE;
