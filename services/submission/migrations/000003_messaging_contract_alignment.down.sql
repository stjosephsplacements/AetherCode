SET ROLE aether_submission_owner;

ALTER TABLE app.inbox_messages ADD COLUMN payload_checksum char(64);
UPDATE app.inbox_messages
SET payload_checksum = encode(payload_sha256, 'hex')
WHERE payload_checksum IS NULL;
ALTER TABLE app.inbox_messages ALTER COLUMN payload_checksum SET NOT NULL;
ALTER TABLE app.inbox_messages DROP COLUMN payload_sha256;
ALTER TABLE app.inbox_messages DROP COLUMN occurred_at;
ALTER TABLE app.inbox_messages RENAME COLUMN failure_count TO attempt_count;
ALTER TABLE app.inbox_messages RENAME COLUMN subject TO event_type;

DROP INDEX IF EXISTS app.outbox_events_pending_idx;
CREATE INDEX outbox_events_ready_idx
    ON app.outbox_events (next_attempt_at, occurred_at)
    WHERE published_at IS NULL;

ALTER TABLE app.outbox_events DROP COLUMN payload_sha256;
ALTER TABLE app.outbox_events ADD COLUMN lock_token uuid;
ALTER TABLE app.outbox_events RENAME COLUMN locked_until TO locked_at;
UPDATE app.outbox_events
SET locked_at = NULL
WHERE locked_at IS NOT NULL;
ALTER TABLE app.outbox_events
    ADD CONSTRAINT outbox_events_lock_pair_check CHECK ((locked_at IS NULL) = (lock_token IS NULL));
ALTER TABLE app.outbox_events RENAME COLUMN publication_attempts TO publish_attempts;
ALTER TABLE app.outbox_events RENAME COLUMN next_attempt_at TO available_at;
ALTER TABLE app.outbox_events RENAME COLUMN event_id TO id;

RESET ROLE;
