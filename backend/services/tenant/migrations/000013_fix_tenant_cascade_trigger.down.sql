-- Restores the function as 000011 defined it, including the placement_organizations
-- update that fails because that table has no tenant_id.
SET ROLE aether_tenant_owner;

CREATE OR REPLACE FUNCTION tenant.cascade_tenant_soft_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
BEGIN
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
        UPDATE tenant.departments
        SET deleted_at = NEW.deleted_at,
            deleted_by = NEW.deleted_by,
            deletion_reason = 'Cascaded from tenant soft delete'
        WHERE tenant_id = NEW.id
          AND deleted_at IS NULL;

        UPDATE tenant.batches
        SET deleted_at = NEW.deleted_at,
            deleted_by = NEW.deleted_by,
            deletion_reason = 'Cascaded from tenant soft delete'
        WHERE tenant_id = NEW.id
          AND deleted_at IS NULL;

        UPDATE tenant.placement_organizations
        SET deleted_at = NEW.deleted_at,
            deleted_by = NEW.deleted_by,
            deletion_reason = 'Cascaded from tenant soft delete'
        WHERE tenant_id = NEW.id
          AND deleted_at IS NULL;
    END IF;
    RETURN NEW;
END;
$$;

RESET ROLE;
