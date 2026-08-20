-- SEB's candidate-facing validation endpoint asks User for a self resource
-- decision. SEB then binds the signed actor to sessions.candidate_id inside
-- its SECURITY DEFINER procedure, so this policy cannot authorize a guessed
-- opaque session ID.
SET ROLE aether_user_owner;

INSERT INTO users.authorization_policy_rules (id, ptype, v0, v1, v2, v3)
VALUES
    ('018f4b0d-08f8-7c09-9ba7-efdf9c220019', 'p', 'student', 'self', '/validation_events/:id', 'write')
ON CONFLICT DO NOTHING;

RESET ROLE;
