SET ROLE aether_assessment_owner;

-- Add node-scoped RLS to the two projection tables that the assessment service
-- owns and that department/batch-scoped staff capabilities must filter.
--
-- student_batch_enrollments: written by SECURITY DEFINER functions only
-- (no direct table privilege for aether_assessment_app). Closed to app reads
-- without a matching node; projection_worker bypasses RLS via its own policy
-- since it operates without a signed authz context.
--
-- batch_department_projections: a projection of tenant batch events. Same
-- access pattern: projection_worker writes, app reads (used as a join source
-- in materialization helpers). Scoped by batch_id (= the batch node).

ALTER TABLE assessment.student_batch_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment.student_batch_enrollments FORCE ROW LEVEL SECURITY;

CREATE POLICY student_batch_enrollments_owner_maintenance
    ON assessment.student_batch_enrollments
    FOR ALL TO aether_assessment_owner
    USING (true) WITH CHECK (true);

-- Projection worker writes enrollment rows via apply_student_enrollment().
-- That function is SECURITY DEFINER so the table access runs as owner, not as
-- projection_worker — this policy is a belt-and-suspenders guard for any
-- direct table grant added in the future.
CREATE POLICY student_batch_enrollments_projection_worker
    ON assessment.student_batch_enrollments
    FOR ALL TO aether_assessment_projection_worker
    USING (true) WITH CHECK (true);

-- App reads enrollments only when the batch_id is covered by the signed
-- capability nodes array. College-level contexts (nodes IS NULL) pass
-- automatically because current_context_covers_node returns true when
-- nodes IS NULL (unrestricted).
CREATE POLICY student_batch_enrollments_app_read
    ON assessment.student_batch_enrollments
    FOR SELECT TO aether_assessment_app
    USING (
        authz.current_context_covers_node(batch_id)
        -- A department-scoped capability covers the batches of that department.
        OR EXISTS (
            SELECT 1 FROM assessment.batch_department_projections AS projection
            WHERE projection.batch_id = student_batch_enrollments.batch_id
              AND authz.current_context_covers_node(projection.department_id)
        )
    );

ALTER TABLE assessment.batch_department_projections ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment.batch_department_projections FORCE ROW LEVEL SECURITY;

CREATE POLICY batch_department_projections_owner_maintenance
    ON assessment.batch_department_projections
    FOR ALL TO aether_assessment_owner
    USING (true) WITH CHECK (true);

CREATE POLICY batch_department_projections_projection_worker
    ON assessment.batch_department_projections
    FOR ALL TO aether_assessment_projection_worker
    USING (true) WITH CHECK (true);

-- batch_department_projections.batch_id is the primary key and the scope
-- node: a batch-scoped capability covers only the batches in its nodes array.
CREATE POLICY batch_department_projections_app_read
    ON assessment.batch_department_projections
    FOR SELECT TO aether_assessment_app
    USING (
        authz.current_context_covers_node(batch_id)
        OR authz.current_context_covers_node(department_id)
    );

GRANT EXECUTE ON FUNCTION authz.current_context_covers_node(uuid)
    TO aether_assessment_app;

RESET ROLE;
