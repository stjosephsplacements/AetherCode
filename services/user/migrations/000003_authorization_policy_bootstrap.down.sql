SET ROLE aether_user_owner;

DROP TRIGGER IF EXISTS authorization_policy_rules_bump_revisions ON users.authorization_policy_rules;
DROP FUNCTION IF EXISTS users.on_authorization_policy_change();
DROP FUNCTION IF EXISTS users.bump_revisions_for_policy_role(text);

DELETE FROM users.authorization_policy_rules
WHERE id IN (
    '018f4b0d-08f8-7c09-9ba7-efdf9c220001',
    '018f4b0d-08f8-7c09-9ba7-efdf9c220002',
    '018f4b0d-08f8-7c09-9ba7-efdf9c220003',
    '018f4b0d-08f8-7c09-9ba7-efdf9c220004',
    '018f4b0d-08f8-7c09-9ba7-efdf9c220005',
    '018f4b0d-08f8-7c09-9ba7-efdf9c220006',
    '018f4b0d-08f8-7c09-9ba7-efdf9c220007',
    '018f4b0d-08f8-7c09-9ba7-efdf9c220008'
);

-- This restores the pre-000003 grant only for an intentional migration
-- rollback. Normal operation must remain on the secure forward migration.
GRANT SELECT, INSERT, UPDATE ON users.authorization_policy_rules TO aether_user_app;

RESET ROLE;
