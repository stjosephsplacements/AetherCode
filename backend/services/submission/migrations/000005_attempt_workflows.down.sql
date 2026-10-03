SET ROLE aether_submission_owner;

DROP FUNCTION IF EXISTS submission.record_judge_completion(
    uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, integer, integer, text, text, text, timestamptz
);
DROP FUNCTION IF EXISTS submission.submit_attempt(uuid, uuid, uuid, uuid, bigint, text, text, jsonb);
DROP FUNCTION IF EXISTS submission.prepare_submission(uuid, uuid, bigint);
DROP FUNCTION IF EXISTS submission.append_answer_revision(
    uuid, uuid, uuid, uuid, uuid, text, text, text, text, bigint
);
DROP FUNCTION IF EXISTS submission.get_attempt_for_candidate(uuid, uuid);
DROP FUNCTION IF EXISTS submission.count_evaluation_requests_for_candidate(uuid, uuid);
DROP FUNCTION IF EXISTS submission.start_attempt(uuid, uuid, uuid, uuid, text, text);
DROP FUNCTION IF EXISTS submission.apply_assignment_snapshot(
    uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, timestamptz, smallint, text, bigint, jsonb
);
DROP FUNCTION IF EXISTS submission.require_authorized_context(uuid, text, text);

-- A projection may only be removed after active attempts have drained. This
-- makes rollback fail closed instead of orphaning evidence or queued work.
DO $rollback_guard$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM submission.attempts
        WHERE lifecycle_state IN ('active', 'submitted', 'grading')
    ) OR EXISTS (
        SELECT 1
        FROM submission.evaluation_requests
        WHERE lifecycle_state IN ('queued', 'dispatched')
    ) THEN
        RAISE EXCEPTION 'cannot roll back submission workflows while attempts or evaluations are active';
    END IF;
END
$rollback_guard$;

DROP TABLE submission.assignment_item_projections;
DROP TABLE submission.assignment_projections;

ALTER TABLE submission.evaluation_requests
    DROP CONSTRAINT evaluation_requests_maximum_score_check;
ALTER TABLE submission.evaluation_requests DROP COLUMN maximum_score;

DROP INDEX submission.attempts_start_idempotency_idx;
ALTER TABLE submission.attempts
    DROP CONSTRAINT attempts_submit_idempotency_pair_check,
    DROP CONSTRAINT attempts_start_idempotency_pair_check,
    DROP COLUMN submit_request_checksum,
    DROP COLUMN submit_idempotency_key,
    DROP COLUMN start_request_checksum,
    DROP COLUMN start_idempotency_key,
    DROP COLUMN available_from;

REVOKE ALL ON TABLE app.inbox_messages FROM aether_submission_projection_worker;
REVOKE USAGE ON SCHEMA app, submission FROM aether_submission_projection_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
    submission.attempts,
    submission.evaluation_requests,
    submission.score_summaries
TO aether_submission_app;
GRANT SELECT, INSERT ON TABLE
    submission.answer_revisions,
    submission.judge_receipts,
    submission.attempt_events
TO aether_submission_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE app.outbox_events, app.inbox_messages, app.idempotency_keys
    TO aether_submission_app;

RESET ROLE;
