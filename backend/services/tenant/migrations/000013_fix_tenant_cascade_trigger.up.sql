-- Deleting a college failed with 'column "tenant_id" does not exist': the cascade
-- also updated tenant.placement_organizations, which are global and have no
-- tenant_id. A college's departments and batches cascade; placement organisations
-- belong to no college and stay.

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
    END IF;
    RETURN NEW;
END;
$$;

RESET ROLE;
