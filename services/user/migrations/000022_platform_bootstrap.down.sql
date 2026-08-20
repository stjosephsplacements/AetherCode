SET ROLE aether_user_owner;

DROP FUNCTION IF EXISTS users.bootstrap_first_superadmin(uuid, uuid);

RESET ROLE;
