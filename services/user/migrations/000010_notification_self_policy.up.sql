-- Notification self-service routes authorize with the bearer subject as the
-- resource ID. Notification's database procedures independently bind that
-- signed actor to the preference/recipient rows before any data is returned.
SET ROLE aether_user_owner;

INSERT INTO users.authorization_policy_rules (id, ptype, v0, v1, v2, v3)
VALUES
    ('018f4b0d-08f8-7c09-9ba7-efdf9c220014', 'p', 'student', 'self', '/recipient_preferences/:id', 'read'),
    ('018f4b0d-08f8-7c09-9ba7-efdf9c220015', 'p', 'student', 'self', '/recipient_preferences/:id', 'write'),
    ('018f4b0d-08f8-7c09-9ba7-efdf9c220016', 'p', 'student', 'self', '/notifications/:id', 'read')
ON CONFLICT DO NOTHING;

RESET ROLE;
