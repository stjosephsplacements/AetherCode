SET ROLE aether_user_owner;

DELETE FROM users.permission_flags
WHERE key IN ('tenant.branding.read', 'tenant.branding.write', 'tenant.branding.delete');

RESET ROLE;