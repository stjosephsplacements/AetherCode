-- Batch-department projection populator and assignment rule backfill support.
-- This migration adds a student enrollment projection and procedures to handle
-- batch creation events and assignment rule backfill.
SET ROLE aether_assessment_owner;

-- Track student-batch enrollments locally so backfill queries don't need to
-- reach into the User service database. This is populated by the same events
-- that drive candidate assignment materialization.
CREATE TABLE assessment.student_batch_enrollments (
    tenant_id uuid NOT NULL,
    student_id uuid NOT NULL,
    batch_id uuid NOT NULL,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    enrolled_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (tenant_id, student_id)
);
CREATE INDEX student_batch_enrollments_batch_idx
    ON assessment.student_batch_enrollments (tenant_id, batch_id, status)
    WHERE status = 'active';

-- Populate the student enrollment projection when enrollment events arrive.
-- This is called alongside materialize_from_enrollment in ApplyStudentEnrolled.
CREATE FUNCTION assessment.apply_student_enrollment(
    p_event_id uuid,
    p_tenant_id uuid,
    p_student_id uuid,
    p_batch_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, assessment, app
AS $function$
BEGIN
    IF p_event_id IS NULL OR p_tenant_id IS NULL OR p_student_id IS NULL OR p_batch_id IS NULL THEN
        RAISE EXCEPTION 'student enrollment projection identifiers are required' USING ERRCODE = '22023';
    END IF;

    INSERT INTO assessment.student_batch_enrollments (tenant_id, student_id, batch_id, status)
    VALUES (p_tenant_id, p_student_id, p_batch_id, 'active')
    ON CONFLICT (tenant_id, student_id) DO UPDATE
    SET batch_id = EXCLUDED.batch_id,
        status = 'active',
        updated_at = clock_timestamp();
END
$function$;

-- Populate batch-department projections when tenant.batch.created.v1 arrives.
-- This ensures we know which department each batch belongs to for rule matching.
CREATE FUNCTION assessment.apply_batch_projection(
    p_event_id uuid,
    p_tenant_id uuid,
    p_batch_id uuid,
    p_department_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, assessment, app
AS $function$
BEGIN
    IF p_event_id IS NULL OR p_tenant_id IS NULL OR p_batch_id IS NULL OR p_department_id IS NULL THEN
        RAISE EXCEPTION 'batch projection identifiers are required' USING ERRCODE = '22023';
    END IF;

    INSERT INTO assessment.batch_department_projections (
        batch_id, tenant_id, department_id, status, source_event_id, source_occurred_at
    )
    VALUES (p_batch_id, p_tenant_id, p_department_id, 'active', p_event_id, clock_timestamp())
    ON CONFLICT (batch_id) DO UPDATE
    SET department_id = EXCLUDED.department_id,
        status = 'active',
        source_event_id = EXCLUDED.source_event_id,
        source_occurred_at = EXCLUDED.source_occurred_at;
END
$function$;

-- Backfill candidate assignments when a new assignment rule is created.
-- This finds all students already enrolled in the rule's target scope and
-- materializes assignments for them using the existing materialization procedure.
CREATE FUNCTION assessment.backfill_from_assignment_rule(
    p_event_id uuid,
    p_tenant_id uuid,
    p_assignment_rule_id uuid,
    p_target_type text,
    p_target_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, assessment, app, extensions
AS $function$
DECLARE
    student_record RECORD;
BEGIN
    IF p_event_id IS NULL OR p_tenant_id IS NULL OR p_assignment_rule_id IS NULL
       OR p_target_type IS NULL OR p_target_id IS NULL THEN
        RAISE EXCEPTION 'backfill identifiers are required' USING ERRCODE = '22023';
    END IF;

    -- Only backfill for batch and department targets. Student targets are
    -- already directly materialized. Placement department targets require
    -- external placement data we don't have yet.
    IF p_target_type NOT IN ('batch', 'department') THEN
        RETURN;
    END IF;

    -- Find all students in the target scope who don't yet have an assignment
    -- from this rule, then call materialize_from_enrollment for each.
    FOR student_record IN
        SELECT DISTINCT sbe.student_id, sbe.batch_id
        FROM assessment.student_batch_enrollments AS sbe
        WHERE sbe.tenant_id = p_tenant_id
          AND sbe.status = 'active'
          AND (
              (p_target_type = 'batch' AND sbe.batch_id = p_target_id)
              OR (p_target_type = 'department' AND sbe.batch_id IN (
                  SELECT bdp.batch_id
                  FROM assessment.batch_department_projections AS bdp
                  WHERE bdp.tenant_id = p_tenant_id
                    AND bdp.department_id = p_target_id
                    AND bdp.status = 'active'
              ))
          )
          AND NOT EXISTS (
              SELECT 1
              FROM assessment.candidate_assignments AS ca
              WHERE ca.tenant_id = p_tenant_id
                AND ca.assignment_rule_id = p_assignment_rule_id
                AND ca.candidate_id = student_record.student_id
          )
    LOOP
        -- Reuse the existing materialization logic for each student.
        -- Generate a synthetic event ID for each invocation since we're
        -- processing multiple students from one rule creation event.
        PERFORM assessment.materialize_from_enrollment(
            extensions.uuid_generate_v7(),
            p_tenant_id,
            student_record.student_id,
            student_record.batch_id
        );
    END LOOP;
END
$function$;

-- Grant execution permissions to the projection worker role.
REVOKE ALL ON FUNCTION assessment.apply_student_enrollment(uuid, uuid, uuid, uuid)
    FROM PUBLIC;
REVOKE ALL ON FUNCTION assessment.apply_batch_projection(uuid, uuid, uuid, uuid)
    FROM PUBLIC;
REVOKE ALL ON FUNCTION assessment.backfill_from_assignment_rule(uuid, uuid, uuid, text, uuid)
    FROM PUBLIC;

GRANT EXECUTE ON FUNCTION assessment.apply_student_enrollment(uuid, uuid, uuid, uuid)
    TO aether_assessment_projection_worker;
GRANT EXECUTE ON FUNCTION assessment.apply_batch_projection(uuid, uuid, uuid, uuid)
    TO aether_assessment_projection_worker;
GRANT EXECUTE ON FUNCTION assessment.backfill_from_assignment_rule(uuid, uuid, uuid, text, uuid)
    TO aether_assessment_projection_worker;

RESET ROLE;
