-- Deleting questions (ADR-0053).
--
-- The soft-delete routes updated qbank.questions directly, which the application
-- role may not do (migration 000003: functions are the only write surface). These
-- functions are that surface. The actor and the permission come from the signed
-- context, never from the caller.
--
-- A question that has ever been published cannot be deleted: exams pin published
-- versions and resolve them by question, and resolution refuses a deleted one, so
-- deleting it would make a live exam's question unloadable. Drafts, including
-- imported and abandoned ones, can go.
SET ROLE aether_question_bank_owner;

CREATE FUNCTION qbank.soft_delete_question(p_question_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qbank, authz, app
AS $function$
DECLARE
    actor_id uuid;
    cleaned text := btrim(COALESCE(p_reason, ''));
BEGIN
    actor_id := qbank.require_write_context('qbank.questions');
    IF p_question_id IS NULL OR char_length(cleaned) NOT BETWEEN 1 AND 500 THEN
        RAISE EXCEPTION 'a deletion needs a reason of 1 to 500 characters' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM qbank.questions WHERE id = p_question_id AND deleted_at IS NULL) THEN
        RAISE EXCEPTION 'question was not found' USING ERRCODE = 'P0002';
    END IF;
    IF EXISTS (SELECT 1 FROM qbank.question_versions WHERE question_id = p_question_id AND status = 'published') THEN
        RAISE EXCEPTION 'deleting a published question is not allowed: exams pin its published versions' USING ERRCODE = '55000';
    END IF;
    UPDATE qbank.question_versions
    SET deleted_at = clock_timestamp(), deleted_by = actor_id, deletion_reason = cleaned
    WHERE question_id = p_question_id AND deleted_at IS NULL;
    UPDATE qbank.questions
    SET deleted_at = clock_timestamp(), deleted_by = actor_id, deletion_reason = cleaned
    WHERE id = p_question_id;
END
$function$;

-- Deletes one draft version. The question goes with it when it was the last version.
CREATE FUNCTION qbank.soft_delete_question_version(p_question_version_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qbank, authz, app
AS $function$
DECLARE
    actor_id uuid;
    cleaned text := btrim(COALESCE(p_reason, ''));
    version_row qbank.question_versions%ROWTYPE;
BEGIN
    actor_id := qbank.require_write_context('qbank.question_versions');
    IF p_question_version_id IS NULL OR char_length(cleaned) NOT BETWEEN 1 AND 500 THEN
        RAISE EXCEPTION 'a deletion needs a reason of 1 to 500 characters' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO version_row FROM qbank.question_versions WHERE id = p_question_version_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'question version was not found' USING ERRCODE = 'P0002';
    END IF;
    IF version_row.status = 'published' THEN
        RAISE EXCEPTION 'deleting a published version is not allowed: exams pin it' USING ERRCODE = '55000';
    END IF;
    UPDATE qbank.question_versions
    SET deleted_at = clock_timestamp(), deleted_by = actor_id, deletion_reason = cleaned
    WHERE id = p_question_version_id;
    IF NOT EXISTS (SELECT 1 FROM qbank.question_versions WHERE question_id = version_row.question_id AND deleted_at IS NULL) THEN
        UPDATE qbank.questions
        SET deleted_at = clock_timestamp(), deleted_by = actor_id, deletion_reason = cleaned
        WHERE id = version_row.question_id AND deleted_at IS NULL;
    END IF;
END
$function$;

REVOKE ALL ON FUNCTION qbank.soft_delete_question(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION qbank.soft_delete_question_version(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION qbank.soft_delete_question(uuid, text) TO aether_question_bank_app;
GRANT EXECUTE ON FUNCTION qbank.soft_delete_question_version(uuid, text) TO aether_question_bank_app;

RESET ROLE;
