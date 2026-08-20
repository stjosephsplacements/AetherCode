-- A populated start projection is required for a truthful rollback boundary:
-- reverting the rollup routine after it has distinguished started candidates
-- would silently conflate those counts again.
SET ROLE aether_analytics_owner;

DO $rollback_guard$
BEGIN
    IF EXISTS (SELECT 1 FROM analytics.attempt_started_projections) THEN
        RAISE EXCEPTION 'cannot roll back attempt-started projection after events were applied';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM analytics.batch_progress_rollups
        WHERE started_count <> completed_count
    ) THEN
        RAISE EXCEPTION 'cannot roll back batch progress while started and completed counts differ';
    END IF;
END
$rollback_guard$;

CREATE OR REPLACE FUNCTION analytics.rebuild_batch_progress(p_tenant_id uuid, p_batch_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, analytics AS $function$
BEGIN
    IF p_tenant_id IS NULL OR p_batch_id IS NULL THEN
        RAISE EXCEPTION 'tenant and batch identifiers are required';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext(p_tenant_id::text), hashtext(p_batch_id::text));

    DELETE FROM analytics.batch_progress_rollups AS rollup
    WHERE rollup.tenant_id = p_tenant_id
      AND rollup.batch_id = p_batch_id
      AND NOT EXISTS (
          SELECT 1
          FROM analytics.student_batch_affiliation_projections AS affiliation
          JOIN analytics.candidate_assignment_projections AS assignment
            ON assignment.tenant_id = affiliation.tenant_id
           AND assignment.candidate_id = affiliation.student_id
          WHERE affiliation.tenant_id = p_tenant_id
            AND affiliation.batch_id = p_batch_id
            AND affiliation.lifecycle_state = 'active'
            AND assignment.lifecycle_state = 'active'
            AND assignment.exam_version_id = rollup.exam_version_id
      );

    WITH active_assignments AS (
        SELECT affiliation.student_id, assignment.candidate_assignment_id,
               assignment.exam_version_id, affiliation.source_revision
        FROM analytics.student_batch_affiliation_projections AS affiliation
        JOIN analytics.candidate_assignment_projections AS assignment
          ON assignment.tenant_id = affiliation.tenant_id
         AND assignment.candidate_id = affiliation.student_id
        WHERE affiliation.tenant_id = p_tenant_id
          AND affiliation.batch_id = p_batch_id
          AND affiliation.lifecycle_state = 'active'
          AND assignment.lifecycle_state = 'active'
    ), assigned_students AS (
        SELECT student_id, exam_version_id, max(source_revision) AS source_revision
        FROM active_assignments
        GROUP BY student_id, exam_version_id
    ), latest_completed_attempts AS (
        SELECT DISTINCT ON (assignment.student_id, assignment.exam_version_id)
               assignment.student_id, assignment.exam_version_id, attempt.score
        FROM active_assignments AS assignment
        JOIN analytics.attempt_projections AS attempt
          ON attempt.tenant_id = p_tenant_id
         AND attempt.candidate_assignment_id = assignment.candidate_assignment_id
         AND attempt.candidate_id = assignment.student_id
         AND attempt.exam_version_id = assignment.exam_version_id
        ORDER BY assignment.student_id, assignment.exam_version_id,
                 attempt.completed_at DESC, attempt.attempt_number DESC, attempt.attempt_id DESC
    )
    INSERT INTO analytics.batch_progress_rollups (
        tenant_id, batch_id, exam_version_id, assigned_count, started_count,
        completed_count, average_score, source_revision, computed_at, version
    )
    SELECT p_tenant_id, p_batch_id, assigned.exam_version_id,
           count(*)::integer,
           count(completed.student_id)::integer,
           count(completed.student_id)::integer,
           avg(completed.score), max(assigned.source_revision), clock_timestamp(), 1
    FROM assigned_students AS assigned
    LEFT JOIN latest_completed_attempts AS completed
      ON completed.student_id = assigned.student_id
     AND completed.exam_version_id = assigned.exam_version_id
    GROUP BY assigned.exam_version_id
    ON CONFLICT (tenant_id, batch_id, exam_version_id) DO UPDATE
    SET assigned_count = EXCLUDED.assigned_count,
        started_count = EXCLUDED.started_count,
        completed_count = EXCLUDED.completed_count,
        average_score = EXCLUDED.average_score,
        source_revision = EXCLUDED.source_revision,
        computed_at = clock_timestamp(),
        version = analytics.batch_progress_rollups.version + 1;
END
$function$;

REVOKE ALL ON TABLE analytics.attempt_started_projections
    FROM aether_analytics_projection_worker;
DROP TABLE analytics.attempt_started_projections;

RESET ROLE;
