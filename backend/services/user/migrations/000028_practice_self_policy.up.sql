-- Students practise on Question Bank's practice problems (ADR-0041). The
-- request names the bearer subject as resource ID and Question Bank binds every
-- practice row to the signed actor, so this cannot reach another student's runs.
SET ROLE aether_user_owner;

INSERT INTO users.authorization_policy_rules (id, ptype, v0, v1, v2, v3)
VALUES
    ('018f4b0d-08f8-7c09-9ba7-efdf9c220041', 'p', 'student', 'self', '/practice_submissions/:id', 'read'),
    ('018f4b0d-08f8-7c09-9ba7-efdf9c220042', 'p', 'student', 'self', '/practice_submissions/:id', 'write')
ON CONFLICT DO NOTHING;

RESET ROLE;
