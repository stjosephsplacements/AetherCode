-- The self relationship is checked against the private Assessment ownership
-- projection in app.assignmentApplies; this Casbin row alone is never enough.
SET ROLE aether_user_owner;

INSERT INTO users.authorization_policy_rules (id, ptype, v0, v1, v2, v3)
VALUES
    ('018f4b0d-08f8-7c09-9ba7-efdf9c220011', 'p', 'student', 'self', '/candidate_assignments/:id', 'read')
ON CONFLICT DO NOTHING;

RESET ROLE;
