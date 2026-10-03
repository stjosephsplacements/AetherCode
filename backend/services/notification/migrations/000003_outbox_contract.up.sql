-- Expand the legacy notification outbox into the shared leased-publisher
-- contract. Pending legacy events remain replayable after this migration.
SET ROLE aether_notification_owner;

ALTER TABLE app.outbox_events RENAME COLUMN id TO event_id;
ALTER TABLE app.outbox_events RENAME COLUMN available_at TO next_attempt_at;
ALTER TABLE app.outbox_events RENAME COLUMN publish_attempts TO publication_attempts;
ALTER TABLE app.outbox_events RENAME COLUMN locked_at TO locked_until;
ALTER TABLE app.outbox_events DROP COLUMN lock_token;

ALTER TABLE app.outbox_events ADD COLUMN payload_sha256 bytea;
UPDATE app.outbox_events
SET payload_sha256 = extensions.digest(convert_to(payload::text, 'UTF8'), 'sha256')
WHERE payload_sha256 IS NULL;
ALTER TABLE app.outbox_events ALTER COLUMN payload_sha256 SET NOT NULL;
ALTER TABLE app.outbox_events
    ADD CONSTRAINT outbox_events_payload_sha256_check
    CHECK (octet_length(payload_sha256) = 32);

-- Legacy lock timestamps represent lease acquisition rather than expiry. A
-- pending legacy lock is therefore released so a rollout cannot strand work.
UPDATE app.outbox_events
SET locked_until = NULL
WHERE published_at IS NULL AND locked_until IS NOT NULL;

DROP INDEX IF EXISTS app.outbox_events_ready_idx;
CREATE INDEX outbox_events_pending_idx
    ON app.outbox_events (next_attempt_at, occurred_at)
    WHERE published_at IS NULL;

RESET ROLE;
