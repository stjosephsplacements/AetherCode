SET ROLE aether_analytics_owner;

DROP FUNCTION IF EXISTS analytics.rebuild_medallion_gold(uuid, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS analytics.rebuild_gold_mentor_batch(uuid, uuid);

DROP TABLE IF EXISTS analytics_gold.gold_mentor_batch_progress;
DROP TABLE IF EXISTS analytics_gold.gold_placement_student;

DROP VIEW IF EXISTS analytics_silver.attempt;
DROP VIEW IF EXISTS analytics_silver.student_affiliation;
DROP VIEW IF EXISTS analytics_bronze.event_facts;

DROP SCHEMA IF EXISTS analytics_gold;
DROP SCHEMA IF EXISTS analytics_silver;
DROP SCHEMA IF EXISTS analytics_bronze;

-- Restore rebuild_student_placement from 000005 (gold-free body).
CREATE OR REPLACE FUNCTION analytics.rebuild_student_placement(p_tenant_id uuid, p_student_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, analytics AS $function$
DECLARE
    affiliation_record analytics.student_affiliation_projections%ROWTYPE;
    latest_attempt analytics.attempt_projections%ROWTYPE;
BEGIN
    DELETE FROM analytics.placement_student_rollups
    WHERE tenant_id = p_tenant_id AND student_id = p_student_id;

    SELECT * INTO affiliation_record
    FROM analytics.student_affiliation_projections
    WHERE tenant_id = p_tenant_id AND student_id = p_student_id;
    IF NOT FOUND THEN
        RETURN;
    END IF;
    SELECT * INTO latest_attempt
    FROM analytics.attempt_projections
    WHERE tenant_id = p_tenant_id AND candidate_id = p_student_id
    ORDER BY completed_at DESC, attempt_id DESC
    LIMIT 1;
    IF NOT FOUND THEN
        RETURN;
    END IF;
    INSERT INTO analytics.placement_student_rollups (
        tenant_id, placement_department_id, student_id, home_department_id,
        latest_exam_version_id, latest_score, latest_activity_at, source_revision, computed_at, version
    ) VALUES (
        p_tenant_id, affiliation_record.placement_department_id, p_student_id,
        affiliation_record.college_department_id, latest_attempt.exam_version_id,
        latest_attempt.score, latest_attempt.completed_at, latest_attempt.attempt_number,
        clock_timestamp(), 1
    ) ON CONFLICT (tenant_id, placement_department_id, student_id) DO UPDATE
    SET home_department_id = EXCLUDED.home_department_id,
        latest_exam_version_id = EXCLUDED.latest_exam_version_id,
        latest_score = EXCLUDED.latest_score,
        latest_activity_at = EXCLUDED.latest_activity_at,
        source_revision = EXCLUDED.source_revision,
        computed_at = clock_timestamp(),
        version = analytics.placement_student_rollups.version + 1;
END
$function$;