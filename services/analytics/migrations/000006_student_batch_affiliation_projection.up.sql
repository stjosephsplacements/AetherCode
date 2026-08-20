-- Materialize the authoritative, current User-owned student-to-batch snapshot.
-- A missing snapshot is deliberately not treated as membership.
SET ROLE aether_analytics_owner;

CREATE TABLE analytics.student_batch_affiliation_projections (
    tenant_id uuid NOT NULL,
    student_id uuid NOT NULL,
    batch_id uuid,
    lifecycle_state text NOT NULL CHECK (lifecycle_state IN ('active', 'inactive')),
    source_revision bigint NOT NULL CHECK (source_revision > 0),
    source_event_id uuid NOT NULL,
    source_occurred_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (tenant_id, student_id),
    CHECK (
        (lifecycle_state = 'active' AND batch_id IS NOT NULL)
        OR (lifecycle_state = 'inactive' AND batch_id IS NULL)
    )
);
CREATE INDEX student_batch_affiliation_active_batch_idx
    ON analytics.student_batch_affiliation_projections (tenant_id, batch_id, student_id)
    WHERE lifecycle_state = 'active';

ALTER TABLE analytics.student_batch_affiliation_projections ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.student_batch_affiliation_projections FORCE ROW LEVEL SECURITY;
CREATE POLICY analytics_student_batch_affiliation_owner_maintenance
    ON analytics.student_batch_affiliation_projections
    FOR ALL TO aether_analytics_owner
    USING (true) WITH CHECK (true);

-- Serializing each student snapshot before reading its predecessor is
-- essential: two transferred snapshots can otherwise each see the same old
-- batch and leave an intermediate batch rollup behind. Runtime workers have no
-- direct table privilege; this narrow function is their only write path.
CREATE FUNCTION analytics.apply_student_batch_affiliation_snapshot(
    p_tenant_id uuid, p_student_id uuid, p_batch_id uuid, p_lifecycle_state text,
    p_source_revision bigint, p_source_event_id uuid, p_source_occurred_at timestamptz
)
RETURNS TABLE (applied boolean, previous_batch_id uuid, current_batch_id uuid)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, analytics AS $function$
DECLARE
    existing_affiliation analytics.student_batch_affiliation_projections%ROWTYPE;
    stored_batch_id uuid;
    write_count bigint;
BEGIN
    IF p_tenant_id IS NULL OR p_student_id IS NULL OR p_source_event_id IS NULL
       OR p_source_occurred_at IS NULL OR p_source_revision <= 0
       OR p_lifecycle_state NOT IN ('active', 'inactive')
       OR (p_lifecycle_state = 'active' AND p_batch_id IS NULL) THEN
        RAISE EXCEPTION 'student batch affiliation snapshot is invalid';
    END IF;
    IF p_lifecycle_state = 'active' THEN
        stored_batch_id := p_batch_id;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(p_tenant_id::text), hashtext(p_student_id::text));
    SELECT * INTO existing_affiliation
    FROM analytics.student_batch_affiliation_projections
    WHERE tenant_id = p_tenant_id AND student_id = p_student_id;

    IF FOUND AND p_source_revision <= existing_affiliation.source_revision THEN
        RETURN QUERY SELECT false, NULL::uuid, NULL::uuid;
        RETURN;
    END IF;
    IF FOUND AND existing_affiliation.lifecycle_state = 'active' THEN
        previous_batch_id := existing_affiliation.batch_id;
    END IF;

    INSERT INTO analytics.student_batch_affiliation_projections (
        tenant_id, student_id, batch_id, lifecycle_state, source_revision,
        source_event_id, source_occurred_at
    ) VALUES (
        p_tenant_id, p_student_id, stored_batch_id, p_lifecycle_state, p_source_revision,
        p_source_event_id, p_source_occurred_at
    ) ON CONFLICT (tenant_id, student_id) DO UPDATE
    SET batch_id = EXCLUDED.batch_id, lifecycle_state = EXCLUDED.lifecycle_state,
        source_revision = EXCLUDED.source_revision, source_event_id = EXCLUDED.source_event_id,
        source_occurred_at = EXCLUDED.source_occurred_at, updated_at = clock_timestamp()
    WHERE EXCLUDED.source_revision > analytics.student_batch_affiliation_projections.source_revision;
    GET DIAGNOSTICS write_count = ROW_COUNT;
    IF write_count = 0 THEN
        RETURN QUERY SELECT false, NULL::uuid, NULL::uuid;
        RETURN;
    END IF;

    RETURN QUERY SELECT true, previous_batch_id,
        CASE WHEN p_lifecycle_state = 'active' THEN p_batch_id ELSE NULL::uuid END;
END
$function$;

-- Recompute from the current authoritative snapshots rather than incrementing
-- counters. That makes transfer, revocation, replay, and late grade delivery
-- converge on one result. The advisory lock prevents competing recomputations
-- of the same tenant/batch from committing an older full snapshot last.
CREATE FUNCTION analytics.rebuild_batch_progress(p_tenant_id uuid, p_batch_id uuid)
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

CREATE FUNCTION analytics.rebuild_student_batch_progress(p_tenant_id uuid, p_student_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, analytics AS $function$
DECLARE active_batch_id uuid;
BEGIN
    IF p_tenant_id IS NULL OR p_student_id IS NULL THEN
        RAISE EXCEPTION 'tenant and student identifiers are required';
    END IF;
    SELECT affiliation.batch_id INTO active_batch_id
    FROM analytics.student_batch_affiliation_projections AS affiliation
    WHERE affiliation.tenant_id = p_tenant_id
      AND affiliation.student_id = p_student_id
      AND affiliation.lifecycle_state = 'active';
    IF FOUND THEN
        PERFORM analytics.rebuild_batch_progress(p_tenant_id, active_batch_id);
    END IF;
END
$function$;

GRANT EXECUTE ON FUNCTION analytics.apply_student_batch_affiliation_snapshot(
    uuid, uuid, uuid, text, bigint, uuid, timestamptz
), analytics.rebuild_batch_progress(uuid, uuid),
    analytics.rebuild_student_batch_progress(uuid, uuid)
TO aether_analytics_projection_worker;
REVOKE ALL ON TABLE analytics.student_batch_affiliation_projections
FROM aether_analytics_projection_worker;
REVOKE ALL ON FUNCTION analytics.apply_student_batch_affiliation_snapshot(
    uuid, uuid, uuid, text, bigint, uuid, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION analytics.rebuild_batch_progress(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION analytics.rebuild_student_batch_progress(uuid, uuid) FROM PUBLIC;

RESET ROLE;
