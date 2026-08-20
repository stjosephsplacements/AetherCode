-- Expand the legacy SEB outbox into the shared, leased publisher contract.
-- Existing events retain their identity and pending events remain eligible for
-- replay; a stale legacy lock becomes an expired lease rather than stranded
-- work.
SET ROLE aether_seb_owner;

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

-- The old column described the time a row was locked, while the publisher
-- contract treats it as lease expiry. Existing lock timestamps are necessarily
-- in the past by deployment time, so pending rows remain replayable.
UPDATE app.outbox_events
SET locked_until = NULL
WHERE published_at IS NULL AND locked_until IS NOT NULL AND locked_until <= clock_timestamp();

DROP INDEX IF EXISTS app.outbox_events_ready_idx;
CREATE INDEX outbox_events_pending_idx
    ON app.outbox_events (next_attempt_at, occurred_at)
    WHERE published_at IS NULL;

RESET ROLE;
