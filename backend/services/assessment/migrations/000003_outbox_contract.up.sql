-- Align the pre-release Assessment outbox with the shared durable publisher
-- contract. The application role continues to write only its own outbox; a
-- publisher replica leases records without ever taking ownership of domain
-- tables.
SET ROLE aether_assessment_owner;

DO $constraints$
DECLARE
    constraint_name text;
BEGIN
    FOR constraint_name IN
        SELECT constraint_item.conname
        FROM pg_constraint AS constraint_item
        WHERE constraint_item.conrelid = 'app.outbox_events'::regclass
          AND constraint_item.contype = 'c'
    LOOP
        EXECUTE format('ALTER TABLE app.outbox_events DROP CONSTRAINT %I', constraint_name);
    END LOOP;
END
$constraints$;

ALTER TABLE app.outbox_events RENAME COLUMN id TO event_id;
ALTER TABLE app.outbox_events RENAME COLUMN available_at TO next_attempt_at;
ALTER TABLE app.outbox_events RENAME COLUMN publish_attempts TO publication_attempts;
ALTER TABLE app.outbox_events ADD COLUMN payload_sha256 bytea;
ALTER TABLE app.outbox_events ADD COLUMN locked_until timestamptz;

UPDATE app.outbox_events
SET payload_sha256 = extensions.digest(convert_to(payload::text, 'UTF8'), 'sha256'),
    locked_until = CASE
        WHEN locked_at IS NULL THEN NULL
        ELSE locked_at + interval '30 seconds'
    END;

ALTER TABLE app.outbox_events ALTER COLUMN payload_sha256 SET NOT NULL;
ALTER TABLE app.outbox_events ALTER COLUMN next_attempt_at SET DEFAULT clock_timestamp();
ALTER TABLE app.outbox_events ALTER COLUMN publication_attempts SET DEFAULT 0;
ALTER TABLE app.outbox_events DROP COLUMN locked_at;
ALTER TABLE app.outbox_events DROP COLUMN lock_token;

ALTER TABLE app.outbox_events
    ADD CONSTRAINT outbox_events_contract_check CHECK (
        length(aggregate_type) BETWEEN 1 AND 120
        AND length(event_type) BETWEEN 1 AND 180
        AND schema_version > 0
        AND jsonb_typeof(payload) = 'object'
        AND octet_length(payload_sha256) = 32
        AND publication_attempts >= 0
    );

DROP INDEX IF EXISTS app.outbox_events_ready_idx;
CREATE INDEX outbox_events_ready_idx
    ON app.outbox_events (next_attempt_at, occurred_at)
    WHERE published_at IS NULL;

RESET ROLE;
