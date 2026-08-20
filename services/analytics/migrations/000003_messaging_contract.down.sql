-- Contract migration rollback is deliberately conservative: it is safe only
-- after all leased work and shared inbox rows have drained.
SET ROLE aether_analytics_owner;

DO $rollback_guard$
BEGIN
    IF EXISTS (SELECT 1 FROM app.outbox_events WHERE payload_sha256 IS NULL)
       OR EXISTS (SELECT 1 FROM app.inbox_messages WHERE payload_sha256 IS NULL) THEN
        RAISE EXCEPTION 'cannot roll back messaging contract with incomplete hashes';
    END IF;
END
$rollback_guard$;

ALTER TABLE app.inbox_messages DROP CONSTRAINT inbox_messages_subject_check;
ALTER TABLE app.inbox_messages DROP CONSTRAINT inbox_messages_payload_sha256_check;
ALTER TABLE app.inbox_messages DROP COLUMN occurred_at;
ALTER TABLE app.inbox_messages
    ALTER COLUMN payload_sha256 TYPE char(64)
    USING encode(payload_sha256, 'hex');
ALTER TABLE app.inbox_messages RENAME COLUMN payload_sha256 TO payload_checksum;
ALTER TABLE app.inbox_messages RENAME COLUMN subject TO event_type;
ALTER TABLE app.inbox_messages
    ADD CONSTRAINT inbox_messages_payload_checksum_check
    CHECK (payload_checksum ~* '^[0-9a-f]{64}$');

DROP INDEX IF EXISTS app.outbox_events_pending_idx;
ALTER TABLE app.outbox_events DROP CONSTRAINT outbox_events_payload_sha256_check;
ALTER TABLE app.outbox_events DROP COLUMN payload_sha256;
ALTER TABLE app.outbox_events ADD COLUMN lock_token uuid;
ALTER TABLE app.outbox_events RENAME COLUMN locked_until TO locked_at;
ALTER TABLE app.outbox_events RENAME COLUMN publication_attempts TO publish_attempts;
ALTER TABLE app.outbox_events RENAME COLUMN next_attempt_at TO available_at;
ALTER TABLE app.outbox_events RENAME COLUMN event_id TO id;
ALTER TABLE app.outbox_events
    ADD CONSTRAINT outbox_events_legacy_lock_check
    CHECK ((locked_at IS NULL) = (lock_token IS NULL));
CREATE INDEX outbox_events_ready_idx ON app.outbox_events (available_at, occurred_at)
    WHERE published_at IS NULL;

RESET ROLE;
