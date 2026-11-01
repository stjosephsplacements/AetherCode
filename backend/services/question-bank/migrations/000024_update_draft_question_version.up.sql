-- Editing a draft question version (ADR-0054).
--
-- A draft's statement, title, difficulty and limits could not be changed once it
-- was saved; an author had to write the question again. A published version stays
-- immutable. Every argument after the revision is optional: NULL leaves the field
-- as it is.
--
-- Changing a limit makes any earlier model-solution check stale (publishing needs
-- a passing check for the current tests and limits), so it is cleared here rather
-- than trusted.
SET ROLE aether_question_bank_owner;

CREATE FUNCTION qbank.update_question_version(
    p_question_version_id uuid,
    p_expected_question_version bigint,
    p_title text,
    p_prompt_markdown text,
    p_difficulty text,
    p_time_limit_ms integer,
    p_memory_limit_kib integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qbank, authz, app
AS $function$
DECLARE
    version_row qbank.question_versions%ROWTYPE;
    new_title text := btrim(p_title);
    new_prompt text := btrim(p_prompt_markdown);
BEGIN
    PERFORM qbank.require_write_context('qbank.question_versions');
    IF p_question_version_id IS NULL OR p_expected_question_version IS NULL
       OR (p_title IS NULL AND p_prompt_markdown IS NULL AND p_difficulty IS NULL AND p_time_limit_ms IS NULL AND p_memory_limit_kib IS NULL)
       OR (p_title IS NOT NULL AND char_length(new_title) NOT BETWEEN 1 AND 300)
       OR (p_prompt_markdown IS NOT NULL AND char_length(new_prompt) < 1)
       OR (p_difficulty IS NOT NULL AND p_difficulty NOT IN ('easy', 'medium', 'hard'))
       OR (p_time_limit_ms IS NOT NULL AND p_time_limit_ms NOT BETWEEN 50 AND 600000)
       OR (p_memory_limit_kib IS NOT NULL AND p_memory_limit_kib NOT BETWEEN 1024 AND 4194304) THEN
        RAISE EXCEPTION 'give at least one valid field to change' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO version_row FROM qbank.question_versions
    WHERE id = p_question_version_id AND deleted_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'question version was not found' USING ERRCODE = 'P0002';
    END IF;
    IF version_row.status <> 'draft' THEN
        RAISE EXCEPTION 'only draft question versions may change' USING ERRCODE = '55000';
    END IF;
    IF version_row.version <> p_expected_question_version THEN
        RAISE EXCEPTION 'question version revision is stale' USING ERRCODE = '40001';
    END IF;
    UPDATE qbank.question_versions
    SET title = COALESCE(new_title, title),
        prompt_markdown = COALESCE(new_prompt, prompt_markdown),
        difficulty = COALESCE(p_difficulty, difficulty),
        time_limit_ms = COALESCE(p_time_limit_ms, time_limit_ms),
        memory_limit_kib = COALESCE(p_memory_limit_kib, memory_limit_kib),
        version = version + 1
    WHERE id = p_question_version_id;
    IF (p_time_limit_ms IS NOT NULL AND p_time_limit_ms <> version_row.time_limit_ms)
       OR (p_memory_limit_kib IS NOT NULL AND p_memory_limit_kib <> version_row.memory_limit_kib) THEN
        UPDATE qbank.model_checks SET bundle_checksum = NULL WHERE question_version_id = p_question_version_id;
    END IF;
    RETURN qbank.question_version_summary(p_question_version_id);
END
$function$;
REVOKE ALL ON FUNCTION qbank.update_question_version(uuid, bigint, text, text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION qbank.update_question_version(uuid, bigint, text, text, text, integer, integer) TO aether_question_bank_app;

RESET ROLE;
