-- Submission binds every candidate-facing attempt operation to the signed
-- context actor in its own database procedure. The authorization request uses
-- the subject UUID as its resource ID, so this policy cannot authorize an
-- arbitrary attempt UUID by itself.
SET ROLE aether_user_owner;

INSERT INTO users.authorization_policy_rules (id, ptype, v0, v1, v2, v3)
VALUES
    ('018f4b0d-08f8-7c09-9ba7-efdf9c220012', 'p', 'student', 'self', '/attempts/:id', 'read'),
    ('018f4b0d-08f8-7c09-9ba7-efdf9c220013', 'p', 'student', 'self', '/attempts/:id', 'write')
ON CONFLICT DO NOTHING;

RESET ROLE;
