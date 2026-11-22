SET ROLE aether_user_owner;

INSERT INTO users.permission_flags (key, bit_index, kind, platform_only, student_managed)
VALUES
    ('user.platform_profiles.read', 214, 'resource', false, false),
    ('user.platform_profiles.write', 215, 'resource', false, false),
    ('user.platform_profiles.delete', 216, 'resource', false, false)
ON CONFLICT (key) DO NOTHING;

UPDATE users.roles
SET permissions = permissions | users.flag_bits(ARRAY['user.platform_profiles.read', 'user.platform_profiles.write'])
WHERE name IN ('college_admin', 'department_user', 'mentor');

RESET ROLE;