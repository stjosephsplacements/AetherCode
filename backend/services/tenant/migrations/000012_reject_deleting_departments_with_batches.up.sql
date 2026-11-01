-- Deleting departments (ADR-0053).
--
-- A department that still has live batches cannot be deleted: its batches would
-- point at a department that is gone, and so would the students in them. Move or
-- delete the batches first. A trigger, so no code path can skip it; SECURITY
-- DEFINER because the caller's signed context covers departments, not batches.
SET ROLE aether_tenant_owner;

CREATE FUNCTION tenant.reject_deleting_department_with_batches()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM tenant.batches WHERE department_id = NEW.id AND deleted_at IS NULL) THEN
        RAISE EXCEPTION 'deleting a department that still has batches is not allowed: delete or move its batches first'
            USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END
$function$;

CREATE TRIGGER departments_reject_deleting_with_batches
    BEFORE UPDATE OF deleted_at ON tenant.departments
    FOR EACH ROW
    EXECUTE FUNCTION tenant.reject_deleting_department_with_batches();

RESET ROLE;
