-- Cascade soft delete: Tenant → Departments → Batches
-- When a tenant is soft-deleted, all its departments and batches are cascaded.

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

CREATE TRIGGER cascade_tenant_soft_delete_trigger
    AFTER UPDATE OF deleted_at ON tenant.tenants
    FOR EACH ROW
    EXECUTE FUNCTION tenant.cascade_tenant_soft_delete();

-- Cascade: Department → Batches
CREATE OR REPLACE FUNCTION tenant.cascade_department_soft_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
BEGIN
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
        UPDATE tenant.batches
        SET deleted_at = NEW.deleted_at,
            deleted_by = NEW.deleted_by,
            deletion_reason = 'Cascaded from department soft delete'
        WHERE department_id = NEW.id
          AND deleted_at IS NULL;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER cascade_department_soft_delete_trigger
    AFTER UPDATE OF deleted_at ON tenant.departments
    FOR EACH ROW
    EXECUTE FUNCTION tenant.cascade_department_soft_delete();

RESET ROLE;
