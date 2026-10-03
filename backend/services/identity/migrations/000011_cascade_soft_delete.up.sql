-- Cascade soft delete: Principal → Credentials → MFA factors
-- Recovery codes are cleaned up via ON DELETE CASCADE when factors are hard-deleted.

SET ROLE aether_identity_owner;

CREATE OR REPLACE FUNCTION identity.cascade_principal_soft_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
BEGIN
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
        UPDATE identity.password_credentials
        SET deleted_at = NEW.deleted_at,
            deleted_by = NEW.deleted_by,
            deletion_reason = 'Cascaded from principal soft delete'
        WHERE principal_id = NEW.id
          AND deleted_at IS NULL;

        UPDATE identity.mfa_factors
        SET deleted_at = NEW.deleted_at,
            deleted_by = NEW.deleted_by,
            deletion_reason = 'Cascaded from principal soft delete'
        WHERE principal_id = NEW.id
          AND deleted_at IS NULL;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER cascade_principal_soft_delete_trigger
    AFTER UPDATE OF deleted_at ON identity.principals
    FOR EACH ROW
    EXECUTE FUNCTION identity.cascade_principal_soft_delete();

RESET ROLE;
