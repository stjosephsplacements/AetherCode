SET ROLE aether_submission_owner;
DROP FUNCTION IF EXISTS submission.list_snapshots(uuid, uuid, integer);
DROP FUNCTION IF EXISTS submission.store_snapshot(uuid, uuid, timestamptz, text, integer);
DROP TABLE IF EXISTS submission.attempt_snapshots;
RESET ROLE;
