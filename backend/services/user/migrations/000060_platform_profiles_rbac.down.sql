SET ROLE aether_user_owner;

UPDATE users.roles
SET permissions = permissions & ~users.flag_bits(ARRAY['user.platform_profiles.read', 'user.platform_profiles.write'])
WHERE name IN ('college_admin', 'department_user', 'mentor');

-- Permission flags are append-only; the three flags stay.

RESET ROLE;