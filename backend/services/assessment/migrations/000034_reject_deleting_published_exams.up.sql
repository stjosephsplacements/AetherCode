-- Deleting exams (ADR-0053).
--
-- Soft-deleting an exam cascades to its versions, assignment rules and candidate
-- assignments (migration 000015), which pulls a published exam out from under the
-- students assigned to it and orphans their results. So an exam that has any
-- version beyond a draft cannot be deleted. The rule is a trigger so that no code
-- path can skip it; SECURITY DEFINER because the caller's own signed context
-- covers exams, not the versions it must look at.
SET ROLE aether_assessment_owner;

-- The cascade from an exam version (migration 000015) soft-deletes its assignment
-- rules, but migration 000012 never gave that table the columns, so deleting any
-- exam failed in the database. Added here the way the other tables got them.
ALTER TABLE assessment.assignment_rules
    ADD COLUMN deleted_at timestamptz,
    ADD COLUMN deleted_by uuid,
    ADD COLUMN deletion_reason text;

CREATE INDEX assignment_rules_deleted_at_idx ON assessment.assignment_rules (deleted_at) WHERE deleted_at IS NOT NULL;

CREATE FUNCTION assessment.reject_published_exam_deletion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL
       AND EXISTS (
           SELECT 1 FROM assessment.exam_versions
           WHERE exam_id = NEW.id AND status <> 'draft' AND deleted_at IS NULL
       ) THEN
        RAISE EXCEPTION 'deleting a published exam is not allowed: students may have been assigned or taken it'
            USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END
$function$;

CREATE TRIGGER exams_reject_published_deletion
    BEFORE UPDATE OF deleted_at ON assessment.exams
    FOR EACH ROW
    EXECUTE FUNCTION assessment.reject_published_exam_deletion();

-- The write itself. The application role may not update assessment.exams directly, so this
-- is the way in; the trigger above still applies to it. The actor is the signed
-- capability's, passed by the service.
CREATE FUNCTION assessment.soft_delete_exam(p_exam_id uuid, p_tenant_id uuid, p_actor_id uuid, p_reason text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, assessment, authz
AS $function$
DECLARE
    cleaned text := btrim(COALESCE(p_reason, ''));
BEGIN
    IF NOT authz.current_context_allows(p_tenant_id, 'assessment.write', 'assessment.exams') THEN
        RAISE EXCEPTION 'authorization denied' USING ERRCODE = '42501';
    END IF;
    IF p_exam_id IS NULL OR p_actor_id IS NULL OR char_length(cleaned) NOT BETWEEN 1 AND 500 THEN
        RAISE EXCEPTION 'a deletion needs a reason of 1 to 500 characters' USING ERRCODE = '22023';
    END IF;
    UPDATE assessment.exams
    SET deleted_at = clock_timestamp(), deleted_by = p_actor_id, deletion_reason = cleaned, updated_at = clock_timestamp()
    WHERE id = p_exam_id AND tenant_id = p_tenant_id AND deleted_at IS NULL;
    RETURN FOUND;
END
$function$;

REVOKE ALL ON FUNCTION assessment.soft_delete_exam(uuid, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assessment.soft_delete_exam(uuid, uuid, uuid, text) TO aether_assessment_app;

RESET ROLE;
