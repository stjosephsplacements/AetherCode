SET ROLE aether_user_owner;

DELETE FROM users.authorization_policy_rules
WHERE id = '018f4b0d-08f8-7c09-9ba7-efdf9c220019';

RESET ROLE;
