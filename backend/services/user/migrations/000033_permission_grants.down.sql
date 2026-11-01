SET ROLE aether_user_owner;

DROP TABLE users.permission_grants;
DROP FUNCTION users.on_permission_grant_change();

RESET ROLE;
