SET ROLE aether_notification_owner;

DO $revoke$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aether_notification_platform_stats_reader') THEN
        REVOKE ALL ON FUNCTION notification.worker_profile_links(uuid) FROM aether_notification_platform_stats_reader;
    END IF;
END
$revoke$;

DROP FUNCTION IF EXISTS notification.worker_profile_links(uuid);

RESET ROLE;
