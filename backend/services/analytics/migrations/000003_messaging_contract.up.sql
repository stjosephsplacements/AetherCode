-- Expand the bootstrap inbox/outbox into the shared leased publisher and
-- transactional consumer contracts. Existing pending work remains replayable.
SET ROLE aether_analytics_owner;

ALTER TABLE app.outbox_events RENAME COLUMN id TO event_id;
ALTER TABLE app.outbox_events RENAME COLUMN available_at TO next_attempt_at;
ALTER TABLE app.outbox_events RENAME COLUMN publish_attempts TO publication_attempts;
ALTER TABLE app.outbox_events RENAME COLUMN locked_at TO locked_until;
DO $drop_legacy_lock_check$
DECLARE constraint_name text;
BEGIN
    FOR constraint_name IN
        SELECT constraint_item.conname
        FROM pg_constraint AS constraint_item
        WHERE constraint_item.conrelid = 'app.outbox_events'::regclass
          AND constraint_item.contype = 'c'
          AND pg_get_constraintdef(constraint_item.oid) LIKE '%lock_token%'
    LOOP
        EXECUTE format('ALTER TABLE app.outbox_events DROP CONSTRAINT %I', constraint_name);
    END LOOP;
END
$drop_legacy_lock_check$;
ALTER TABLE app.outbox_events DROP COLUMN lock_token;

ALTER TABLE app.outbox_events ADD COLUMN payload_sha256 bytea;
UPDATE app.outbox_events
SET payload_sha256 = extensions.digest(convert_to(payload::text, 'UTF8'), 'sha256')
WHERE payload_sha256 IS NULL;
ALTER TABLE app.outbox_events ALTER COLUMN payload_sha256 SET NOT NULL;
ALTER TABLE app.outbox_events
    ADD CONSTRAINT outbox_events_payload_sha256_check
    CHECK (octet_length(payload_sha256) = 32);

-- A bootstrap lock timestamp was an acquisition instant, not a lease expiry.
-- Treat it as expired so no publisher crash can strand an event.
UPDATE app.outbox_events
SET locked_until = NULL
WHERE locked_until IS NOT NULL;

DROP INDEX IF EXISTS app.outbox_events_ready_idx;
CREATE INDEX outbox_events_pending_idx
    ON app.outbox_events (next_attempt_at, occurred_at)
    WHERE published_at IS NULL;

ALTER TABLE app.inbox_messages RENAME COLUMN event_type TO subject;
DO $drop_legacy_inbox_hash_check$
DECLARE constraint_name text;
BEGIN
    FOR constraint_name IN
        SELECT constraint_item.conname
        FROM pg_constraint AS constraint_item
        WHERE constraint_item.conrelid = 'app.inbox_messages'::regclass
          AND constraint_item.contype = 'c'
          AND pg_get_constraintdef(constraint_item.oid) LIKE '%payload_checksum%'
    LOOP
        EXECUTE format('ALTER TABLE app.inbox_messages DROP CONSTRAINT %I', constraint_name);
    END LOOP;
END
$drop_legacy_inbox_hash_check$;
ALTER TABLE app.inbox_messages RENAME COLUMN payload_checksum TO payload_sha256;
ALTER TABLE app.inbox_messages
    ALTER COLUMN payload_sha256 TYPE bytea
    USING decode(payload_sha256, 'hex');
ALTER TABLE app.inbox_messages
    ADD COLUMN occurred_at timestamptz NOT NULL DEFAULT clock_timestamp();
ALTER TABLE app.inbox_messages
    ADD CONSTRAINT inbox_messages_payload_sha256_check
    CHECK (octet_length(payload_sha256) = 32);
ALTER TABLE app.inbox_messages
    ADD CONSTRAINT inbox_messages_subject_check
    CHECK (length(subject) BETWEEN 1 AND 180);

RESET ROLE;
