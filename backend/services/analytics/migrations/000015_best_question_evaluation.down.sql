SET ROLE aether_analytics_owner;

CREATE OR REPLACE FUNCTION analytics.rebuild_attempt_rollups(p_tenant_id uuid, p_attempt_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, analytics AS $function$
DECLARE attempt_record analytics.attempt_projections%ROWTYPE;
BEGIN
    SELECT * INTO attempt_record
    FROM analytics.attempt_projections
    WHERE tenant_id = p_tenant_id AND attempt_id = p_attempt_id;
    IF NOT FOUND THEN
        RETURN;
    END IF;

    INSERT INTO analytics.exam_result_rollups (
        tenant_id, exam_id, exam_version_id, candidate_id, attempt_id,
        lifecycle_state, score, maximum_score, submitted_at, graded_at,
        candidate_assignment_id, attempt_number, source_revision, computed_at, version
    ) VALUES (
        attempt_record.tenant_id, attempt_record.exam_id, attempt_record.exam_version_id,
        attempt_record.candidate_id, attempt_record.attempt_id, 'graded', attempt_record.score,
        attempt_record.maximum_score, attempt_record.completed_at, attempt_record.completed_at,
        attempt_record.candidate_assignment_id, attempt_record.attempt_number,
        attempt_record.attempt_number, clock_timestamp(), 1
    ) ON CONFLICT (tenant_id, attempt_id) DO UPDATE
    SET lifecycle_state = EXCLUDED.lifecycle_state,
        score = EXCLUDED.score,
        maximum_score = EXCLUDED.maximum_score,
        submitted_at = EXCLUDED.submitted_at,
        graded_at = EXCLUDED.graded_at,
        candidate_assignment_id = EXCLUDED.candidate_assignment_id,
        attempt_number = EXCLUDED.attempt_number,
        source_revision = EXCLUDED.source_revision,
        computed_at = clock_timestamp(),
        version = analytics.exam_result_rollups.version + 1;

    DELETE FROM analytics.attempt_question_results
    WHERE tenant_id = p_tenant_id AND attempt_id = p_attempt_id;
    INSERT INTO analytics.attempt_question_results (
        tenant_id, attempt_id, student_id, question_id, awarded_score,
        maximum_score, accepted, completed_at
    )
    SELECT attempt_record.tenant_id, attempt_record.attempt_id,
           attempt_record.candidate_id, item.question_id,
           sum(CASE WHEN evaluation.verdict = 'accepted' THEN evaluation.maximum_score ELSE 0 END),
           sum(evaluation.maximum_score), bool_and(evaluation.verdict = 'accepted'),
           attempt_record.completed_at
    FROM analytics.evaluation_projections AS evaluation
    JOIN analytics.exam_item_projections AS item
      ON item.tenant_id = evaluation.tenant_id
     AND item.exam_item_id = evaluation.exam_item_id
    WHERE evaluation.tenant_id = p_tenant_id
      AND evaluation.attempt_id = p_attempt_id
      AND evaluation.verdict IS NOT NULL
    GROUP BY item.question_id;

    DELETE FROM analytics.student_progress_rollups
    WHERE tenant_id = p_tenant_id AND student_id = attempt_record.candidate_id;
    INSERT INTO analytics.student_progress_rollups (
        tenant_id, student_id, question_id, attempts_count, accepted_count,
        best_score, last_attempt_at, source_revision, computed_at, version
    )
    SELECT result.tenant_id, result.student_id, result.question_id,
           count(*)::integer,
           count(*) FILTER (WHERE result.accepted)::integer,
           max(result.awarded_score), max(result.completed_at),
           max(attempt.attempt_number), clock_timestamp(), 1
    FROM analytics.attempt_question_results AS result
    JOIN analytics.attempt_projections AS attempt
      ON attempt.tenant_id = result.tenant_id
     AND attempt.attempt_id = result.attempt_id
    WHERE result.tenant_id = p_tenant_id
      AND result.student_id = attempt_record.candidate_id
    GROUP BY result.tenant_id, result.student_id, result.question_id;

    PERFORM analytics.rebuild_student_placement(p_tenant_id, attempt_record.candidate_id);
END
$function$;

RESET ROLE;
