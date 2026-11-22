SET ROLE aether_user_owner;

UPDATE users.roles
SET permissions = permissions & ~users.flag_bits(ARRAY['user.platform_profiles.read', 'user.platform_profiles.write'])
WHERE name IN ('college_admin', 'department_user', 'mentor');

DELETE FROM users.permission_flags
WHERE key IN ('user.platform_profiles.read', 'user.platform_profiles.write', 'user.platform_profiles.delete');

RESET ROLE;