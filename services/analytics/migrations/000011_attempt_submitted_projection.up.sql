-- Add submitted_at timestamp to exam_result_rollups to enable time-to-submit
-- metrics. The apply_attempt_submitted function is idempotent and only updates
-- if the attempt exists in the rollups table.
SET ROLE aether_analytics_owner;

ALTER TABLE analytics.exam_result_rollups
	ADD COLUMN IF NOT EXISTS submitted_at timestamptz;

CREATE FUNCTION analytics.apply_attempt_submitted(
	p_event_id uuid,
	p_tenant_id uuid,
	p_attempt_id uuid,
	p_candidate_id uuid,
	p_submitted_at timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, analytics
AS $function$
BEGIN
	UPDATE analytics.exam_result_rollups
	SET submitted_at = p_submitted_at
	WHERE tenant_id = p_tenant_id AND attempt_id = p_attempt_id;
END
$function$;

REVOKE ALL ON FUNCTION analytics.apply_attempt_submitted(uuid, uuid, uuid, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION analytics.apply_attempt_submitted(uuid, uuid, uuid, uuid, timestamptz)
	TO aether_analytics_projection_worker;

RESET ROLE;
