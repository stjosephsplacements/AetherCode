SET ROLE aether_user_owner;

DROP FUNCTION users.tenant_readable_principals(uuid, uuid[]);
DROP FUNCTION users.list_staff_audit(uuid, timestamptz, integer);
DROP FUNCTION users.record_staff_action(uuid, uuid, text, text, text, boolean);
DROP TABLE users.staff_audit;

RESET ROLE;
