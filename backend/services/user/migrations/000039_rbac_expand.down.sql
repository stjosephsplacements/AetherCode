SET ROLE aether_user_owner;

DROP INDEX IF EXISTS users.role_assignments_role_id_idx;
ALTER TABLE users.role_assignments DROP COLUMN IF EXISTS role_id;
DROP TABLE IF EXISTS users.permission_overwrites;
DROP TRIGGER IF EXISTS roles_protect_managed ON users.roles;
DROP TABLE IF EXISTS users.roles;
DROP FUNCTION IF EXISTS users.protect_managed_role();
DROP FUNCTION IF EXISTS users.ensure_guild_roles(text, uuid);
DROP FUNCTION IF EXISTS users.flag_bits(text[]);
DROP TRIGGER IF EXISTS permission_flags_append_only ON users.permission_flags;
DROP TABLE IF EXISTS users.permission_flags;
DROP FUNCTION IF EXISTS users.permission_flags_append_only();

RESET ROLE;
