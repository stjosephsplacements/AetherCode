SET ROLE aether_notification_owner;

DROP INDEX IF EXISTS app.outbox_events_pending_idx;
ALTER TABLE app.outbox_events DROP CONSTRAINT IF EXISTS outbox_events_payload_sha256_check;
ALTER TABLE app.outbox_events DROP COLUMN payload_sha256;

-- A rolled-back publisher has no lease expiry semantics. Release active
-- leases before restoring its older lock-pair schema.
UPDATE app.outbox_events SET locked_until = NULL WHERE published_at IS NULL;
ALTER TABLE app.outbox_events ADD COLUMN lock_token uuid;
ALTER TABLE app.outbox_events
    ADD CONSTRAINT outbox_events_legacy_lock_check
    CHECK ((locked_until IS NULL) = (lock_token IS NULL));
ALTER TABLE app.outbox_events RENAME COLUMN locked_until TO locked_at;
ALTER TABLE app.outbox_events RENAME COLUMN publication_attempts TO publish_attempts;
ALTER TABLE app.outbox_events RENAME COLUMN next_attempt_at TO available_at;
ALTER TABLE app.outbox_events RENAME COLUMN event_id TO id;
CREATE INDEX outbox_events_ready_idx
    ON app.outbox_events (available_at, occurred_at)
    WHERE published_at IS NULL;

RESET ROLE;
