SET ROLE aether_assessment_owner;

ALTER TABLE app.outbox_events DROP CONSTRAINT IF EXISTS outbox_events_contract_check;
DROP INDEX IF EXISTS app.outbox_events_ready_idx;

ALTER TABLE app.outbox_events ADD COLUMN locked_at timestamptz;
ALTER TABLE app.outbox_events ADD COLUMN lock_token uuid;
UPDATE app.outbox_events
SET locked_at = locked_until,
    lock_token = CASE
        WHEN locked_until IS NULL THEN NULL
        ELSE extensions.gen_random_uuid()
    END;

ALTER TABLE app.outbox_events DROP COLUMN locked_until;
ALTER TABLE app.outbox_events DROP COLUMN payload_sha256;
ALTER TABLE app.outbox_events RENAME COLUMN publication_attempts TO publish_attempts;
ALTER TABLE app.outbox_events RENAME COLUMN next_attempt_at TO available_at;
ALTER TABLE app.outbox_events RENAME COLUMN event_id TO id;
ALTER TABLE app.outbox_events ALTER COLUMN available_at SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE app.outbox_events ALTER COLUMN publish_attempts SET DEFAULT 0;

ALTER TABLE app.outbox_events
    ADD CONSTRAINT outbox_events_legacy_lock_check
    CHECK ((locked_at IS NULL) = (lock_token IS NULL));
ALTER TABLE app.outbox_events
    ADD CONSTRAINT outbox_events_legacy_contract_check CHECK (
        length(aggregate_type) BETWEEN 1 AND 120
        AND length(event_type) BETWEEN 1 AND 180
        AND schema_version > 0
        AND jsonb_typeof(payload) = 'object'
        AND publish_attempts >= 0
    );

CREATE INDEX outbox_events_ready_idx
    ON app.outbox_events (available_at, occurred_at)
    WHERE published_at IS NULL;

RESET ROLE;
