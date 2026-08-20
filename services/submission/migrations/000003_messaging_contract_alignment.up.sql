-- Align the original Submission bootstrap tables with the shared durable
-- messaging stores. This is deliberately an expand/backfill transition: old
-- rows retain their IDs and become eligible for safe at-least-once replay.
SET ROLE aether_submission_owner;

ALTER TABLE app.outbox_events RENAME COLUMN id TO event_id;
ALTER TABLE app.outbox_events RENAME COLUMN available_at TO next_attempt_at;
ALTER TABLE app.outbox_events RENAME COLUMN publish_attempts TO publication_attempts;
ALTER TABLE app.outbox_events RENAME COLUMN locked_at TO locked_until;

DO $constraints$
DECLARE
    constraint_name text;
BEGIN
    FOR constraint_name IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'app.outbox_events'::regclass
          AND pg_get_constraintdef(oid) LIKE '%lock_token%'
    LOOP
        EXECUTE format('ALTER TABLE app.outbox_events DROP CONSTRAINT %I', constraint_name);
    END LOOP;
END
$constraints$;

-- A historical lock had no lease duration. Clearing it makes the event
-- replayable after the migration instead of risking a permanently stranded
-- publication.
UPDATE app.outbox_events
SET locked_until = NULL
WHERE locked_until IS NOT NULL;

ALTER TABLE app.outbox_events DROP COLUMN lock_token;
ALTER TABLE app.outbox_events ADD COLUMN payload_sha256 bytea;
UPDATE app.outbox_events
SET payload_sha256 = extensions.digest(convert_to(payload::text, 'UTF8'), 'sha256')
WHERE payload_sha256 IS NULL;
ALTER TABLE app.outbox_events ALTER COLUMN payload_sha256 SET NOT NULL;

-- Retain trace_id for observability compatibility. Shared publishers ignore it;
-- new writers use the canonical lease fields above.
DROP INDEX IF EXISTS app.outbox_events_ready_idx;
CREATE INDEX outbox_events_pending_idx
    ON app.outbox_events (next_attempt_at, occurred_at)
    WHERE published_at IS NULL;

ALTER TABLE app.inbox_messages RENAME COLUMN event_type TO subject;
ALTER TABLE app.inbox_messages RENAME COLUMN attempt_count TO failure_count;
ALTER TABLE app.inbox_messages ADD COLUMN occurred_at timestamptz;
UPDATE app.inbox_messages
SET occurred_at = received_at
WHERE occurred_at IS NULL;
ALTER TABLE app.inbox_messages ALTER COLUMN occurred_at SET NOT NULL;
ALTER TABLE app.inbox_messages ADD COLUMN payload_sha256 bytea;
UPDATE app.inbox_messages
SET payload_sha256 = decode(payload_checksum, 'hex')
WHERE payload_sha256 IS NULL;
ALTER TABLE app.inbox_messages ALTER COLUMN payload_sha256 SET NOT NULL;
ALTER TABLE app.inbox_messages DROP COLUMN payload_checksum;

RESET ROLE;
