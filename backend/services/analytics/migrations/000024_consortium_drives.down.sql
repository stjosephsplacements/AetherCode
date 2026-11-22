SET ROLE aether_analytics_owner;

DROP FUNCTION IF EXISTS analytics.consortium_drive_leaderboard(uuid, integer);
DROP FUNCTION IF EXISTS analytics.list_consortium_drives(uuid);
DROP FUNCTION IF EXISTS analytics.create_consortium_drive(uuid, text, timestamptz, timestamptz);
DROP TABLE IF EXISTS analytics.consortium_drives;

RESET ROLE;