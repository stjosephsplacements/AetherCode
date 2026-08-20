-- The durable outbox rows remain intact on rollback. Removing this helper only
-- returns an older service binary to its previous behavior; it does not erase
-- append-only attempt evidence or already-published analytics facts.
SET ROLE aether_submission_owner;

REVOKE EXECUTE ON FUNCTION submission.prepare_attempt_submitted_outbox_event(uuid, uuid, uuid, uuid)
    FROM aether_submission_app;
DROP FUNCTION submission.prepare_attempt_submitted_outbox_event(uuid, uuid, uuid, uuid);
DROP INDEX app.outbox_events_attempt_submitted_once_idx;

RESET ROLE;
