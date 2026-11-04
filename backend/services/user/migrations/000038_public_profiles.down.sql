SET ROLE aether_user_owner;

DROP FUNCTION IF EXISTS users.set_own_public_profile(uuid, text, boolean, jsonb);
DROP FUNCTION IF EXISTS users.own_public_profile(uuid);
DROP FUNCTION IF EXISTS users.public_profile_by_slug(text);
DROP TABLE IF EXISTS users.public_profiles;

RESET ROLE;
