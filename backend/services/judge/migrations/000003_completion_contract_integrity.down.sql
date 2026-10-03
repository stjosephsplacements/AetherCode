SET ROLE aether_judge_migrator;

DO $rollback_guard$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM judge.outbox_events
        WHERE event_type IN ('judge.completed.v1', 'judge.failed.v1')
    ) THEN
        RAISE EXCEPTION 'cannot roll back Judge completion contract integrity while terminal outbox records exist';
    END IF;
END
$rollback_guard$;

DROP TRIGGER IF EXISTS outbox_events_completion_contract ON judge.outbox_events;
DROP FUNCTION IF EXISTS judge.validate_completion_outbox_payload();

RESET ROLE;
