SET ROLE aether_submission_owner;

DO $block$
BEGIN
    IF EXISTS (SELECT 1 FROM submission.evaluation_requests WHERE origin = 'regrade') THEN
        RAISE EXCEPTION 'regrade evaluations exist; remove them before reverting 000034';
    END IF;
END
$block$;

DROP FUNCTION submission.regrade_exam_item(uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION submission.attempt_item_scores(p_tenant_id uuid, p_attempt_id uuid)
RETURNS TABLE (exam_item_id uuid, score numeric, maximum_score numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, submission
AS $function$
    SELECT revision.exam_item_id,
           max(submission.evaluation_score(p_tenant_id, request_row.id)),
           max(request_row.maximum_score)
    FROM submission.evaluation_requests AS request_row
    JOIN submission.answer_revisions AS revision
      ON revision.tenant_id = request_row.tenant_id
     AND revision.id = request_row.answer_revision_id
    WHERE request_row.tenant_id = p_tenant_id
      AND request_row.attempt_id = p_attempt_id
    GROUP BY revision.exam_item_id
    UNION ALL
    -- Multiple choice is all-or-nothing: the selection must equal the key.
    SELECT item.exam_item_id,
           CASE WHEN choice.selected IS NOT NULL
                     AND (SELECT array_agg(value ORDER BY value) FROM unnest(choice.selected) AS value)
                       = (SELECT array_agg(value ORDER BY value) FROM unnest(item.correct_choices) AS value)
                THEN item.maximum_score ELSE 0 END,
           item.maximum_score
    FROM submission.attempts AS attempt
    JOIN submission.assignment_item_projections AS item
      ON item.tenant_id = attempt.tenant_id AND item.candidate_assignment_id = attempt.candidate_assignment_id
     AND item.kind = 'mcq'
    JOIN submission.choice_answers AS choice
      ON choice.tenant_id = attempt.tenant_id AND choice.attempt_id = attempt.id AND choice.exam_item_id = item.exam_item_id
    WHERE attempt.tenant_id = p_tenant_id AND attempt.id = p_attempt_id
$function$;

ALTER TABLE submission.evaluation_requests
    DROP CONSTRAINT evaluation_requests_origin_check,
    ADD CONSTRAINT evaluation_requests_origin_check CHECK (origin IN ('final', 'item_submit')),
    DROP CONSTRAINT evaluation_requests_revision_bundle_key,
    ADD CONSTRAINT evaluation_requests_tenant_id_answer_revision_id_key UNIQUE (tenant_id, answer_revision_id);

RESET ROLE;
