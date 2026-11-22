SET ROLE aether_user_owner;

INSERT INTO users.permission_flags (key, bit_index, kind, elevated, platform_only)
VALUES
    ('tenant.branding.read', 214, 'resource', false, false),
    ('tenant.branding.write', 215, 'resource', false, false),
    ('tenant.branding.delete', 216, 'resource', false, false)
ON CONFLICT (key) DO NOTHING;

RESET ROLE;