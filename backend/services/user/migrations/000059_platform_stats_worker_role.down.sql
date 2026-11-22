SET ROLE aether_user_owner;

DO $revoke$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aether_user_platform_stats_worker') THEN
        REVOKE ALL ON FUNCTION users.platform_stats_save(uuid, text, jsonb, text, text) FROM aether_user_platform_stats_worker;
        REVOKE ALL ON FUNCTION users.platform_stats_claim_refresh(integer) FROM aether_user_platform_stats_worker;
        REVOKE ALL ON FUNCTION users.platform_stats_upsert_link(uuid, uuid, text, text) FROM aether_user_platform_stats_worker;
        REVOKE ALL ON TABLE users.platform_stats_sync_requests FROM aether_user_platform_stats_worker;
        REVOKE ALL ON TABLE users.platform_stats FROM aether_user_platform_stats_worker;
        REVOKE ALL ON TABLE users.students FROM aether_user_platform_stats_worker;
        REVOKE USAGE ON SCHEMA users FROM aether_user_platform_stats_worker;
    END IF;
END
$revoke$;

RESET ROLE;
