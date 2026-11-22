SET ROLE aether_user_owner;
DROP FUNCTION IF EXISTS users.platform_stats_save(uuid, text, jsonb, text, text);
DROP FUNCTION IF EXISTS users.platform_stats_claim_refresh(integer);
DROP FUNCTION IF EXISTS users.platform_stats_upsert_link(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS users.platform_profiles_sync_request(uuid, uuid);
DROP FUNCTION IF EXISTS users.platform_profiles_list(uuid, text, text, uuid, integer, text);
DROP TABLE IF EXISTS users.platform_stats_sync_requests;
DROP TABLE IF EXISTS users.platform_stats;
RESET ROLE;