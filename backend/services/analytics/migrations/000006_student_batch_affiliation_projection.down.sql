-- Rollback is safe only before the event-fed batch projection has materialized.
SET ROLE aether_analytics_owner;

DO $rollback_guard$
BEGIN
    IF EXISTS (SELECT 1 FROM analytics.student_batch_affiliation_projections) THEN
        RAISE EXCEPTION 'cannot roll back student-batch affiliation projection after snapshots were applied';
    END IF;
    IF EXISTS (SELECT 1 FROM analytics.batch_progress_rollups) THEN
        RAISE EXCEPTION 'cannot roll back student-batch affiliation projection while batch rollups exist';
    END IF;
END
$rollback_guard$;

DROP FUNCTION analytics.rebuild_student_batch_progress(uuid, uuid);
DROP FUNCTION analytics.rebuild_batch_progress(uuid, uuid);
DROP FUNCTION analytics.apply_student_batch_affiliation_snapshot(
    uuid, uuid, uuid, text, bigint, uuid, timestamptz
);
DROP TABLE analytics.student_batch_affiliation_projections;

RESET ROLE;
