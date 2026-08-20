SET ROLE aether_user_owner;

-- A student may manage only its own profile. The central policy is paired
-- with assignmentApplies' self-scope check and the profile RLS helper.
INSERT INTO users.authorization_policy_rules (id, ptype, v0, v1, v2, v3)
VALUES
    ('018f4b0d-08f8-7c09-9ba7-efdf9c220009', 'p', 'student', 'self', '/profiles/:id', 'read'),
    ('018f4b0d-08f8-7c09-9ba7-efdf9c220010', 'p', 'student', 'self', '/profiles/:id', 'write')
ON CONFLICT DO NOTHING;

RESET ROLE;
