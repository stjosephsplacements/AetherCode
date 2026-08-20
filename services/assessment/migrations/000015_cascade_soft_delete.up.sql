-- Cascade soft delete: Exam → ExamVersions, AssignmentRules, CandidateAssignments
-- When an exam is soft-deleted, all its versions and assignments are cascaded.

SET ROLE aether_assessment_owner;

CREATE OR REPLACE FUNCTION assessment.cascade_exam_soft_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
BEGIN
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
        UPDATE assessment.exam_versions
        SET deleted_at = NEW.deleted_at,
            deleted_by = NEW.deleted_by,
            deletion_reason = 'Cascaded from exam soft delete'
        WHERE exam_id = NEW.id
          AND deleted_at IS NULL;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER cascade_exam_soft_delete_trigger
    AFTER UPDATE OF deleted_at ON assessment.exams
    FOR EACH ROW
    EXECUTE FUNCTION assessment.cascade_exam_soft_delete();

-- Cascade: ExamVersion → AssignmentRules → CandidateAssignments
CREATE OR REPLACE FUNCTION assessment.cascade_exam_version_soft_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
BEGIN
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
        UPDATE assessment.assignment_rules
        SET deleted_at = NEW.deleted_at,
            deleted_by = NEW.deleted_by,
            deletion_reason = 'Cascaded from exam version soft delete'
        WHERE exam_version_id = NEW.id
          AND deleted_at IS NULL;

        UPDATE assessment.candidate_assignments
        SET deleted_at = NEW.deleted_at,
            deleted_by = NEW.deleted_by,
            deletion_reason = 'Cascaded from exam version soft delete'
        WHERE exam_version_id = NEW.id
          AND deleted_at IS NULL;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER cascade_exam_version_soft_delete_trigger
    AFTER UPDATE OF deleted_at ON assessment.exam_versions
    FOR EACH ROW
    EXECUTE FUNCTION assessment.cascade_exam_version_soft_delete();

RESET ROLE;
