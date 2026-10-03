-- A start fact is durable independently of terminal grading. Retaining it as
-- a local projection lets batch reports distinguish candidates who began an
-- active assignment from candidates whose work has completed.
SET ROLE aether_analytics_owner;

CREATE TABLE analytics.attempt_started_projections (
    tenant_id uuid NOT NULL,
    attempt_id uuid NOT NULL,
    candidate_assignment_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    exam_id uuid NOT NULL,
    exam_version_id uuid NOT NULL,
    started_at timestamptz NOT NULL,
    source_event_id uuid NOT NULL,
    source_occurred_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (tenant_id, attempt_id)
);
CREATE INDEX attempt_started_projections_assignment_idx
    ON analytics.attempt_started_projections (
        tenant_id, candidate_assignment_id, candidate_id, exam_id, exam_version_id
    );

ALTER TABLE analytics.attempt_started_projections ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.attempt_started_projections FORCE ROW LEVEL SECURITY;
CREATE POLICY analytics_attempt_started_projections_projection_worker
    ON analytics.attempt_started_projections
    FOR ALL TO aether_analytics_projection_worker
    USING (true) WITH CHECK (true);
CREATE POLICY analytics_attempt_started_projections_owner_maintenance
    ON analytics.attempt_started_projections
    FOR ALL TO aether_analytics_owner
    USING (true) WITH CHECK (true);

-- Build from complete current projections every time. The union treats a
-- completed attempt as proof that its candidate started even if the start
-- subject is delivered after the terminal-grade subject, preserving the rollup
-- invariant completed_count <= started_count during cross-subject replay.
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
               assignment.exam_id, assignment.exam_version_id, affiliation.source_revision
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
         AND attempt.exam_id = assignment.exam_id
         AND attempt.exam_version_id = assignment.exam_version_id
        ORDER BY assignment.student_id, assignment.exam_version_id,
                 attempt.completed_at DESC, attempt.attempt_number DESC, attempt.attempt_id DESC
    ), started_students AS (
        SELECT DISTINCT assignment.student_id, assignment.exam_version_id
        FROM active_assignments AS assignment
        JOIN analytics.attempt_started_projections AS attempt_started
          ON attempt_started.tenant_id = p_tenant_id
         AND attempt_started.candidate_assignment_id = assignment.candidate_assignment_id
         AND attempt_started.candidate_id = assignment.student_id
         AND attempt_started.exam_id = assignment.exam_id
         AND attempt_started.exam_version_id = assignment.exam_version_id
        UNION
        SELECT student_id, exam_version_id
        FROM latest_completed_attempts
    )
    INSERT INTO analytics.batch_progress_rollups (
        tenant_id, batch_id, exam_version_id, assigned_count, started_count,
        completed_count, average_score, source_revision, computed_at, version
    )
    SELECT p_tenant_id, p_batch_id, assigned.exam_version_id,
           count(*)::integer,
           count(started.student_id)::integer,
           count(completed.student_id)::integer,
           avg(completed.score), max(assigned.source_revision), clock_timestamp(), 1
    FROM assigned_students AS assigned
    LEFT JOIN started_students AS started
      ON started.student_id = assigned.student_id
     AND started.exam_version_id = assigned.exam_version_id
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

REVOKE ALL ON TABLE analytics.attempt_started_projections FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE analytics.attempt_started_projections
    TO aether_analytics_projection_worker;
GRANT EXECUTE ON FUNCTION analytics.rebuild_batch_progress(uuid, uuid)
    TO aether_analytics_projection_worker;

RESET ROLE;
