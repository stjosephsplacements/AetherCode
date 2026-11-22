-- ADR-0067 phase 1: gold placement rollups, mentor batch gold, rebuild command, bronze/silver views.
SET ROLE aether_analytics_owner;

CREATE SCHEMA IF NOT EXISTS analytics_bronze;
CREATE SCHEMA IF NOT EXISTS analytics_silver;
CREATE SCHEMA IF NOT EXISTS analytics_gold;

-- Bronze: raw event facts with lineage fields exposed for replay tooling.
CREATE OR REPLACE VIEW analytics_bronze.event_facts AS
SELECT
    fact.id,
    fact.occurred_at,
    fact.ingested_at,
    fact.tenant_id,
    fact.source_event_id,
    fact.source_event_id::text AS stream_seq,
    fact.source_service AS subject,
  1 AS schema_version,
    encode(extensions.digest(convert_to(fact.payload::text, 'UTF8'), 'sha256'), 'hex') AS payload_hash,
    fact.event_type,
    fact.subject_id,
    fact.source_subject_type,
    fact.payload,
    fact.retention_until,
    fact.legal_hold
FROM (
    SELECT
        id,
        occurred_at,
        occurred_at AS ingested_at,
        tenant_id,
        source_event_id,
        source_service,
        event_type,
        subject_id,
        source_subject_type,
        payload,
        retention_until,
        legal_hold
    FROM analytics.event_facts
) AS fact;

-- Silver: compatibility views over today's conformed projections.
CREATE OR REPLACE VIEW analytics_silver.student_affiliation AS
SELECT
    projection.*,
    projection.source_event_id,
    projection.source_event_id AS bronze_fact_id,
    1 AS pipeline_version,
    projection.updated_at AS processed_at
FROM analytics.student_affiliation_projections AS projection;

CREATE OR REPLACE VIEW analytics_silver.attempt AS
SELECT
    projection.*,
    projection.source_event_id,
    projection.source_event_id AS bronze_fact_id,
    1 AS pipeline_version,
    projection.updated_at AS processed_at
FROM analytics.attempt_projections AS projection;

CREATE TABLE analytics_gold.gold_placement_student (
    tenant_id uuid NOT NULL,
    placement_department_id uuid NOT NULL,
    student_id uuid NOT NULL,
    home_department_id uuid NOT NULL,
    latest_exam_version_id uuid,
    latest_score numeric(12,4),
    latest_activity_at timestamptz,
    source_revision bigint NOT NULL DEFAULT 0 CHECK (source_revision >= 0),
    computed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    PRIMARY KEY (tenant_id, placement_department_id, student_id),
    CHECK (latest_score IS NULL OR latest_score >= 0)
);
CREATE INDEX gold_placement_student_department_idx
    ON analytics_gold.gold_placement_student (tenant_id, placement_department_id, latest_activity_at DESC NULLS LAST);

CREATE TABLE analytics_gold.gold_mentor_batch_progress (
    tenant_id uuid NOT NULL,
    batch_id uuid NOT NULL,
    exam_version_id uuid NOT NULL,
    assigned_count integer NOT NULL DEFAULT 0 CHECK (assigned_count >= 0),
    started_count integer NOT NULL DEFAULT 0 CHECK (started_count >= 0),
    completed_count integer NOT NULL DEFAULT 0 CHECK (completed_count >= 0),
    average_score numeric(12,4),
    source_revision bigint NOT NULL DEFAULT 0 CHECK (source_revision >= 0),
    computed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    PRIMARY KEY (tenant_id, batch_id, exam_version_id),
    CHECK (started_count <= assigned_count),
    CHECK (completed_count <= started_count),
    CHECK (average_score IS NULL OR average_score >= 0)
);
CREATE INDEX gold_mentor_batch_progress_batch_idx
    ON analytics_gold.gold_mentor_batch_progress (tenant_id, batch_id, computed_at DESC);

ALTER TABLE analytics_gold.gold_placement_student ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_gold.gold_placement_student FORCE ROW LEVEL SECURITY;
ALTER TABLE analytics_gold.gold_mentor_batch_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_gold.gold_mentor_batch_progress FORCE ROW LEVEL SECURITY;

CREATE POLICY analytics_gold_placement_student_signed_read
    ON analytics_gold.gold_placement_student FOR SELECT TO aether_analytics_app
    USING (authz.current_context_allows_read(tenant_id, 'analytics.read', 'analytics.write', 'analytics.placement_student_rollups')
        AND authz.current_context_covers_node(placement_department_id));

CREATE POLICY analytics_gold_placement_student_worker
    ON analytics_gold.gold_placement_student FOR ALL TO aether_analytics_projection_worker
    USING (true) WITH CHECK (true);

CREATE POLICY analytics_gold_placement_student_owner
    ON analytics_gold.gold_placement_student FOR ALL TO aether_analytics_owner
    USING (true) WITH CHECK (true);

CREATE POLICY analytics_gold_mentor_batch_signed_read
    ON analytics_gold.gold_mentor_batch_progress FOR SELECT TO aether_analytics_app
    USING (authz.current_context_allows_read(tenant_id, 'analytics.read', 'analytics.write', 'analytics.batch_progress_rollups')
        AND authz.current_context_covers_node(batch_id));

CREATE POLICY analytics_gold_mentor_batch_worker
    ON analytics_gold.gold_mentor_batch_progress FOR ALL TO aether_analytics_projection_worker
    USING (true) WITH CHECK (true);

CREATE POLICY analytics_gold_mentor_batch_owner
    ON analytics_gold.gold_mentor_batch_progress FOR ALL TO aether_analytics_owner
    USING (true) WITH CHECK (true);

GRANT SELECT ON analytics_bronze.event_facts TO aether_analytics_app, aether_analytics_projection_worker;
GRANT SELECT ON analytics_silver.student_affiliation, analytics_silver.attempt TO aether_analytics_app, aether_analytics_projection_worker;

INSERT INTO analytics_gold.gold_placement_student (
    tenant_id, placement_department_id, student_id, home_department_id,
    latest_exam_version_id, latest_score, latest_activity_at, source_revision, computed_at, version
)
SELECT
    tenant_id, placement_department_id, student_id, home_department_id,
    latest_exam_version_id, latest_score, latest_activity_at, source_revision, computed_at, version
FROM analytics.placement_student_rollups;

INSERT INTO analytics_gold.gold_mentor_batch_progress (
    tenant_id, batch_id, exam_version_id,
    assigned_count, started_count, completed_count, average_score,
    source_revision, computed_at, version
)
SELECT
    tenant_id, batch_id, exam_version_id,
    assigned_count, started_count, completed_count, average_score,
    source_revision, computed_at, version
FROM analytics.batch_progress_rollups;

CREATE OR REPLACE FUNCTION analytics.rebuild_gold_mentor_batch(p_tenant_id uuid, p_batch_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, analytics, analytics_gold AS $function$
BEGIN
    IF p_tenant_id IS NULL OR p_batch_id IS NULL THEN
        RAISE EXCEPTION 'tenant and batch identifiers are required';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext(p_tenant_id::text), hashtext(p_batch_id::text));

    DELETE FROM analytics_gold.gold_mentor_batch_progress
    WHERE tenant_id = p_tenant_id AND batch_id = p_batch_id;

    INSERT INTO analytics_gold.gold_mentor_batch_progress (
        tenant_id, batch_id, exam_version_id,
        assigned_count, started_count, completed_count, average_score,
        source_revision, computed_at, version
    )
    SELECT
        tenant_id, batch_id, exam_version_id,
        assigned_count, started_count, completed_count, average_score,
        source_revision, clock_timestamp(), 1
    FROM analytics.batch_progress_rollups
    WHERE tenant_id = p_tenant_id AND batch_id = p_batch_id;
END
$function$;

CREATE OR REPLACE FUNCTION analytics.rebuild_student_placement(p_tenant_id uuid, p_student_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, analytics, analytics_gold AS $function$
DECLARE
    affiliation_record analytics.student_affiliation_projections%ROWTYPE;
    latest_attempt analytics.attempt_projections%ROWTYPE;
BEGIN
    DELETE FROM analytics.placement_student_rollups
    WHERE tenant_id = p_tenant_id AND student_id = p_student_id;
    DELETE FROM analytics_gold.gold_placement_student
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

    INSERT INTO analytics_gold.gold_placement_student (
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
        version = analytics_gold.gold_placement_student.version + 1;
END
$function$;

CREATE OR REPLACE FUNCTION analytics.rebuild_medallion_gold(
    p_tenant_id uuid,
    p_from timestamptz DEFAULT NULL,
    p_to timestamptz DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, analytics, analytics_gold AS $function$
DECLARE
    student_row record;
    batch_row record;
BEGIN
    IF p_tenant_id IS NULL THEN
        RAISE EXCEPTION 'tenant_id is required';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('analytics.rebuild_medallion_gold', 0), hashtext(p_tenant_id::text));

    FOR student_row IN
        SELECT DISTINCT student_id
        FROM analytics.student_affiliation_projections
        WHERE tenant_id = p_tenant_id
          AND placement_department_id IS NOT NULL
    LOOP
        PERFORM analytics.rebuild_student_placement(p_tenant_id, student_row.student_id);
    END LOOP;

    FOR batch_row IN
        SELECT DISTINCT batch_id
        FROM analytics.student_batch_affiliation_projections
        WHERE tenant_id = p_tenant_id AND lifecycle_state = 'active' AND batch_id IS NOT NULL
    LOOP
        PERFORM analytics.rebuild_batch_progress(p_tenant_id, batch_row.batch_id);
        PERFORM analytics.rebuild_batch_progress_by_department(p_tenant_id, batch_row.batch_id);
        PERFORM analytics.rebuild_gold_mentor_batch(p_tenant_id, batch_row.batch_id);
    END LOOP;

    -- Optional window is accepted for API compatibility; silver still rebuilds from full projections.
    IF p_from IS NOT NULL AND p_to IS NOT NULL AND p_from > p_to THEN
        RAISE EXCEPTION 'rebuild window is invalid';
    END IF;
END
$function$;

REVOKE ALL ON FUNCTION analytics.rebuild_gold_mentor_batch(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION analytics.rebuild_medallion_gold(uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION analytics.rebuild_gold_mentor_batch(uuid, uuid) TO aether_analytics_projection_worker;
GRANT EXECUTE ON FUNCTION analytics.rebuild_medallion_gold(uuid, timestamptz, timestamptz) TO aether_analytics_projection_worker, aether_analytics_owner;