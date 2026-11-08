-- Department-sliced batch progress rollup.
--
-- batch_progress_rollups groups by (tenant_id, batch_id, exam_version_id).  A
-- batch spans multiple college departments so staff scoped to one department
-- cannot derive their slice from that table.  This table adds department_id to
-- the PK, allowing department-scoped capabilities to read only their slice.
--
-- The projection worker calls rebuild_batch_progress_by_department whenever a
-- student affiliation or assignment snapshot changes, mirroring the pattern
-- used by rebuild_batch_progress.
SET ROLE aether_analytics_owner;

CREATE TABLE analytics.batch_progress_department_rollups (
    tenant_id      uuid    NOT NULL,
    batch_id       uuid    NOT NULL,
    department_id  uuid    NOT NULL,
    exam_version_id uuid   NOT NULL,
    assigned_count  integer NOT NULL DEFAULT 0 CHECK (assigned_count >= 0),
    started_count   integer NOT NULL DEFAULT 0 CHECK (started_count >= 0),
    completed_count integer NOT NULL DEFAULT 0 CHECK (completed_count >= 0),
    average_score   numeric(12,4),
    source_revision bigint  NOT NULL DEFAULT 0 CHECK (source_revision >= 0),
    computed_at     timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version         bigint  NOT NULL DEFAULT 1 CHECK (version > 0),
    PRIMARY KEY (tenant_id, batch_id, department_id, exam_version_id),
    CHECK (started_count  <= assigned_count),
    CHECK (completed_count <= started_count),
    CHECK (average_score IS NULL OR average_score >= 0)
);
CREATE INDEX batch_progress_department_batch_idx
    ON analytics.batch_progress_department_rollups (tenant_id, batch_id, department_id, computed_at DESC);

ALTER TABLE analytics.batch_progress_department_rollups ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.batch_progress_department_rollups FORCE ROW LEVEL SECURITY;

-- Tenant-level read gate (same shape as batch_progress_rollups_signed_read in 000002).
CREATE POLICY analytics_batch_progress_dept_rollups_signed_read
    ON analytics.batch_progress_department_rollups
    FOR SELECT TO aether_analytics_app
    USING (authz.current_context_allows_read(
        tenant_id,
        'analytics.read', 'analytics.write',
        'analytics.batch_progress_department_rollups'
    )
    -- Node-scoped: batch-scoped capabilities gate on batch_id;
    -- college-level contexts (nodes IS NULL) are unrestricted.
    AND authz.current_context_covers_node(batch_id));

CREATE POLICY analytics_batch_progress_dept_rollups_signed_insert
    ON analytics.batch_progress_department_rollups
    FOR INSERT TO aether_analytics_app
    WITH CHECK (authz.current_context_allows(
        tenant_id, 'analytics.write', 'analytics.batch_progress_department_rollups'
    ));

CREATE POLICY analytics_batch_progress_dept_rollups_signed_update
    ON analytics.batch_progress_department_rollups
    FOR UPDATE TO aether_analytics_app
    USING    (authz.current_context_allows(tenant_id, 'analytics.write', 'analytics.batch_progress_department_rollups'))
    WITH CHECK (authz.current_context_allows(tenant_id, 'analytics.write', 'analytics.batch_progress_department_rollups'));

CREATE POLICY analytics_batch_progress_dept_rollups_signed_delete
    ON analytics.batch_progress_department_rollups
    FOR DELETE TO aether_analytics_app
    USING (authz.current_context_allows(
        tenant_id, 'analytics.write', 'analytics.batch_progress_department_rollups'
    ));

CREATE POLICY analytics_batch_progress_dept_rollups_owner_maintenance
    ON analytics.batch_progress_department_rollups
    FOR ALL TO aether_analytics_owner
    USING (true) WITH CHECK (true);

CREATE POLICY analytics_batch_progress_dept_rollups_worker
    ON analytics.batch_progress_department_rollups
    FOR ALL TO aether_analytics_projection_worker
    USING (true) WITH CHECK (true);

-- Recompute the department slice for one (tenant, batch).
-- Joins student_affiliation_projections (college_department_id) against the
-- same projections used by rebuild_batch_progress, then groups by department.
-- The advisory lock uses the same key as rebuild_batch_progress so the two
-- functions serialize against each other on the same tenant/batch pair.
CREATE FUNCTION analytics.rebuild_batch_progress_by_department(
    p_tenant_id uuid,
    p_batch_id  uuid
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, analytics AS $function$
BEGIN
    IF p_tenant_id IS NULL OR p_batch_id IS NULL THEN
        RAISE EXCEPTION 'tenant and batch identifiers are required';
    END IF;
    PERFORM pg_advisory_xact_lock(
        hashtext(p_tenant_id::text), hashtext(p_batch_id::text)
    );

    -- Remove rows whose exam version no longer has active assignments in this batch.
    DELETE FROM analytics.batch_progress_department_rollups AS rollup
    WHERE rollup.tenant_id = p_tenant_id
      AND rollup.batch_id  = p_batch_id
      AND NOT EXISTS (
          SELECT 1
          FROM analytics.student_batch_affiliation_projections AS affiliation
          JOIN analytics.candidate_assignment_projections AS assignment
            ON assignment.tenant_id    = affiliation.tenant_id
           AND assignment.candidate_id = affiliation.student_id
          WHERE affiliation.tenant_id       = p_tenant_id
            AND affiliation.batch_id        = p_batch_id
            AND affiliation.lifecycle_state = 'active'
            AND assignment.lifecycle_state  = 'active'
            AND assignment.exam_version_id  = rollup.exam_version_id
      );

    WITH active_assignments AS (
        SELECT
            affiliation.student_id,
            aff_proj.college_department_id,
            assignment.candidate_assignment_id,
            assignment.exam_id,
            assignment.exam_version_id,
            affiliation.source_revision
        FROM analytics.student_batch_affiliation_projections AS affiliation
        JOIN analytics.student_affiliation_projections AS aff_proj
          ON aff_proj.tenant_id  = affiliation.tenant_id
         AND aff_proj.student_id = affiliation.student_id
        JOIN analytics.candidate_assignment_projections AS assignment
          ON assignment.tenant_id    = affiliation.tenant_id
         AND assignment.candidate_id = affiliation.student_id
        WHERE affiliation.tenant_id       = p_tenant_id
          AND affiliation.batch_id        = p_batch_id
          AND affiliation.lifecycle_state = 'active'
          AND assignment.lifecycle_state  = 'active'
    ), assigned_students AS (
        SELECT
            student_id,
            college_department_id,
            exam_version_id,
            max(source_revision) AS source_revision
        FROM active_assignments
        GROUP BY student_id, college_department_id, exam_version_id
    ), latest_completed_attempts AS (
        SELECT DISTINCT ON (assignment.student_id, assignment.exam_version_id)
               assignment.student_id,
               assignment.college_department_id,
               assignment.exam_version_id,
               attempt.score
        FROM active_assignments AS assignment
        JOIN analytics.attempt_projections AS attempt
          ON attempt.tenant_id               = p_tenant_id
         AND attempt.candidate_assignment_id = assignment.candidate_assignment_id
         AND attempt.candidate_id            = assignment.student_id
         AND attempt.exam_id                 = assignment.exam_id
         AND attempt.exam_version_id         = assignment.exam_version_id
        ORDER BY
            assignment.student_id,
            assignment.exam_version_id,
            attempt.completed_at DESC,
            attempt.attempt_number DESC,
            attempt.attempt_id DESC
    ), started_students AS (
        SELECT DISTINCT assignment.student_id, assignment.college_department_id, assignment.exam_version_id
        FROM active_assignments AS assignment
        JOIN analytics.attempt_started_projections AS attempt_started
          ON attempt_started.tenant_id               = p_tenant_id
         AND attempt_started.candidate_assignment_id = assignment.candidate_assignment_id
         AND attempt_started.candidate_id            = assignment.student_id
         AND attempt_started.exam_id                 = assignment.exam_id
         AND attempt_started.exam_version_id         = assignment.exam_version_id
        UNION
        SELECT student_id, college_department_id, exam_version_id
        FROM latest_completed_attempts
    )
    INSERT INTO analytics.batch_progress_department_rollups (
        tenant_id, batch_id, department_id, exam_version_id,
        assigned_count, started_count, completed_count, average_score,
        source_revision, computed_at, version
    )
    SELECT
        p_tenant_id,
        p_batch_id,
        assigned.college_department_id,
        assigned.exam_version_id,
        count(*)::integer,
        count(started.student_id)::integer,
        count(completed.student_id)::integer,
        avg(completed.score),
        max(assigned.source_revision),
        clock_timestamp(),
        1
    FROM assigned_students AS assigned
    LEFT JOIN started_students AS started
      ON started.student_id          = assigned.student_id
     AND started.college_department_id = assigned.college_department_id
     AND started.exam_version_id     = assigned.exam_version_id
    LEFT JOIN latest_completed_attempts AS completed
      ON completed.student_id          = assigned.student_id
     AND completed.college_department_id = assigned.college_department_id
     AND completed.exam_version_id     = assigned.exam_version_id
    GROUP BY assigned.college_department_id, assigned.exam_version_id
    ON CONFLICT (tenant_id, batch_id, department_id, exam_version_id) DO UPDATE
    SET assigned_count  = EXCLUDED.assigned_count,
        started_count   = EXCLUDED.started_count,
        completed_count = EXCLUDED.completed_count,
        average_score   = EXCLUDED.average_score,
        source_revision = EXCLUDED.source_revision,
        computed_at     = clock_timestamp(),
        version         = analytics.batch_progress_department_rollups.version + 1;
END
$function$;

REVOKE ALL ON TABLE analytics.batch_progress_department_rollups FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE analytics.batch_progress_department_rollups
    TO aether_analytics_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE analytics.batch_progress_department_rollups
    TO aether_analytics_projection_worker;
REVOKE ALL ON FUNCTION analytics.rebuild_batch_progress_by_department(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION analytics.rebuild_batch_progress_by_department(uuid, uuid)
    TO aether_analytics_projection_worker;

RESET ROLE;
