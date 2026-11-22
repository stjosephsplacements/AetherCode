SET ROLE aether_notification_owner;
REVOKE ALL ON FUNCTION notification.worker_profile_links(uuid) FROM aether_notification_platform_stats_reader;
DROP FUNCTION IF EXISTS notification.worker_profile_links(uuid);
DROP ROLE IF EXISTS aether_notification_platform_stats_reader;
RESET ROLE;