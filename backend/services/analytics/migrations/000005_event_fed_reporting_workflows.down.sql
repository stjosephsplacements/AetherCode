SET ROLE aether_analytics_owner;

DO $rollback_guard$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM analytics.exam_result_rollups
        GROUP BY tenant_id, exam_version_id, candidate_id
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'cannot roll back exam-result attempt support with multiple attempts per candidate';
    END IF;
END
$rollback_guard$;

DROP POLICY IF EXISTS analytics_event_facts_projection_worker ON analytics.event_facts;
DROP FUNCTION IF EXISTS analytics.purge_expired_retained_data(integer);
DROP FUNCTION IF EXISTS analytics.request_report_export(uuid, uuid, text, jsonb, uuid);
DROP FUNCTION IF EXISTS analytics.apply_legal_hold(uuid, uuid, text, uuid, boolean, uuid);
DROP FUNCTION IF EXISTS analytics.rebuild_attempt_rollups(uuid, uuid);
DROP FUNCTION IF EXISTS analytics.rebuild_student_placement(uuid, uuid);
DROP FUNCTION IF EXISTS authz.current_context_actor_id();

DROP TABLE analytics.retention_policy_revisions;
DROP TABLE analytics.legal_hold_projections;
DROP TABLE analytics.attempt_question_results;
DROP TABLE analytics.attempt_projections;
DROP TABLE analytics.judge_completion_projections;
DROP TABLE analytics.evaluation_projections;
DROP TABLE analytics.candidate_assignment_projections;
DROP TABLE analytics.exam_item_projections;
DROP TABLE analytics.student_affiliation_projections;

ALTER TABLE analytics.exam_result_rollups
    DROP COLUMN candidate_assignment_id,
    DROP COLUMN attempt_number;
ALTER TABLE analytics.exam_result_rollups
    ADD CONSTRAINT exam_result_rollups_tenant_id_exam_version_id_candidate_id_key
    UNIQUE (tenant_id, exam_version_id, candidate_id);

ALTER TABLE analytics.event_facts DROP COLUMN source_subject_type;
CREATE OR REPLACE FUNCTION analytics.reject_event_fact_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $function$
BEGIN
    RAISE EXCEPTION 'analytics event facts are append-only' USING ERRCODE = '55000';
END
$function$;

CREATE OR REPLACE FUNCTION app.ensure_analytics_event_fact_partitions(
    partition_through timestamptz DEFAULT (CURRENT_TIMESTAMP + interval '2 months')
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, app, analytics AS $function$
DECLARE
    partition_start timestamptz := date_trunc('month', CURRENT_TIMESTAMP);
    partition_limit timestamptz := date_trunc('month', partition_through);
    partition_end timestamptz;
    partition_name text;
BEGIN
    WHILE partition_start <= partition_limit LOOP
        partition_end := partition_start + interval '1 month';
        partition_name := format('event_facts_%s', to_char(partition_start, 'YYYYMM'));
        EXECUTE format('CREATE TABLE IF NOT EXISTS analytics.%I PARTITION OF analytics.event_facts FOR VALUES FROM (%L) TO (%L)', partition_name, partition_start, partition_end);
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON analytics.%I (tenant_id, event_type, occurred_at DESC)', format('%s_tenant_event_idx', partition_name), partition_name);
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON analytics.%I (retention_until) WHERE NOT legal_hold', format('%s_retention_idx', partition_name), partition_name);
        partition_start := partition_end;
    END LOOP;
END
$function$;
REVOKE ALL ON FUNCTION app.ensure_analytics_event_fact_partitions(timestamptz) FROM aether_analytics_projection_worker;

GRANT INSERT, UPDATE, DELETE ON TABLE
    analytics.student_progress_rollups,
    analytics.exam_result_rollups,
    analytics.batch_progress_rollups,
    analytics.placement_student_rollups,
    analytics.report_exports,
    analytics.event_facts
TO aether_analytics_app;
REVOKE SELECT, INSERT, UPDATE ON TABLE app.inbox_messages
FROM aether_analytics_projection_worker;

RESET ROLE;
