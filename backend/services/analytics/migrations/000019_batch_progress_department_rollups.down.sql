SET ROLE aether_analytics_owner;

REVOKE EXECUTE ON FUNCTION analytics.rebuild_batch_progress_by_department(uuid, uuid)
    FROM aether_analytics_projection_worker;
DROP FUNCTION IF EXISTS analytics.rebuild_batch_progress_by_department(uuid, uuid);
DROP TABLE IF EXISTS analytics.batch_progress_department_rollups;

RESET ROLE;
