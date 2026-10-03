-- Remove the attempt_submitted projection handler and the submitted_at column.
SET ROLE aether_analytics_owner;

DROP FUNCTION IF EXISTS analytics.apply_attempt_submitted(uuid, uuid, uuid, uuid, timestamptz);

ALTER TABLE analytics.exam_result_rollups
	DROP COLUMN IF EXISTS submitted_at;

RESET ROLE;
