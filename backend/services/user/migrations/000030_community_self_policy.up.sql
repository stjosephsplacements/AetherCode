-- Students read and contribute to community content (ADR-0048). The request
-- names the bearer subject as resource ID and Notification binds every write to
-- the signed actor. community_moderation gets no student rule.
SET ROLE aether_user_owner;

INSERT INTO users.authorization_policy_rules (id, ptype, v0, v1, v2, v3)
VALUES
    ('018f4b0d-08f8-7c09-9ba7-efdf9c220051', 'p', 'student', 'self', '/community/:id', 'read'),
    ('018f4b0d-08f8-7c09-9ba7-efdf9c220052', 'p', 'student', 'self', '/community/:id', 'write')
ON CONFLICT DO NOTHING;

RESET ROLE;
