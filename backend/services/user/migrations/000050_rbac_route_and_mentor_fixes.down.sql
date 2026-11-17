SET ROLE aether_user_owner;

DROP FUNCTION IF EXISTS users.principal_has_tenant_role(uuid, uuid);

UPDATE users.roles
SET permissions = permissions & ~users.flag_bits(ARRAY[
    'analytics.batch_progress_department_rollups.read',
    'analytics.batch_progress_department_rollups.write',
    'analytics.batch_progress_department_rollups.delete'])
WHERE managed AND system_key IN ('department_user', 'mentor');
-- The permission-flag registry is append-only (trigger), so the three flags stay.

RESET ROLE;
