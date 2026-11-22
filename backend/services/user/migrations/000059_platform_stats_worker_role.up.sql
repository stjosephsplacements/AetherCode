-- Role aether_user_platform_stats_worker is created by platform bootstrap
-- (deploy/database/platform/dev-init.sh); this migration only grants.
SET ROLE aether_user_owner;

DO $grant$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aether_user_platform_stats_worker') THEN
        GRANT USAGE ON SCHEMA users TO aether_user_platform_stats_worker;
        GRANT SELECT, INSERT, UPDATE, DELETE ON users.platform_stats TO aether_user_platform_stats_worker;
        GRANT SELECT, INSERT, UPDATE, DELETE ON users.platform_stats_sync_requests TO aether_user_platform_stats_worker;
        GRANT SELECT ON users.students TO aether_user_platform_stats_worker;
        GRANT EXECUTE ON FUNCTION users.platform_stats_upsert_link(uuid, uuid, text, text) TO aether_user_platform_stats_worker;
        GRANT EXECUTE ON FUNCTION users.platform_stats_claim_refresh(integer) TO aether_user_platform_stats_worker;
        GRANT EXECUTE ON FUNCTION users.platform_stats_save(uuid, text, jsonb, text, text) TO aether_user_platform_stats_worker;
    END IF;
END
$grant$;

RESET ROLE;
