SET ROLE aether_question_bank_owner;

REVOKE EXECUTE ON FUNCTION
    qbank.create_question(uuid, uuid, uuid, text, text, text, text, jsonb, integer, integer, text, text, text, jsonb),
    qbank.create_draft_question_version(uuid, uuid, uuid, bigint, text, text, text, jsonb, integer, integer, text, text, text, jsonb),
    qbank.upsert_test_case_manifest(uuid, uuid, text, text, text, text, integer, bigint),
    qbank.add_question_asset(uuid, uuid, text, text, text, text, text, bigint, bigint),
    qbank.replace_question_version_tags(uuid, bigint, jsonb),
    qbank.publish_question_version(uuid, uuid, bigint),
    qbank.archive_question(uuid, uuid, bigint),
    qbank.get_published_question(uuid),
    qbank.get_question_version(uuid),
    qbank.list_published_questions(integer)
FROM aether_question_bank_app;

DROP TRIGGER IF EXISTS question_versions_require_publish_ready ON qbank.question_versions;
DROP FUNCTION IF EXISTS qbank.list_published_questions(integer);
DROP FUNCTION IF EXISTS qbank.get_question_version(uuid);
DROP FUNCTION IF EXISTS qbank.get_published_question(uuid);
DROP FUNCTION IF EXISTS qbank.archive_question(uuid, uuid, bigint);
DROP FUNCTION IF EXISTS qbank.publish_question_version(uuid, uuid, bigint);
DROP FUNCTION IF EXISTS qbank.replace_question_version_tags(uuid, bigint, jsonb);
DROP FUNCTION IF EXISTS qbank.add_question_asset(uuid, uuid, text, text, text, text, text, bigint, bigint);
DROP FUNCTION IF EXISTS qbank.upsert_test_case_manifest(uuid, uuid, text, text, text, text, integer, bigint);
DROP FUNCTION IF EXISTS qbank.create_draft_question_version(uuid, uuid, uuid, bigint, text, text, text, jsonb, integer, integer, text, text, text, jsonb);
DROP FUNCTION IF EXISTS qbank.create_question(uuid, uuid, uuid, text, text, text, text, jsonb, integer, integer, text, text, text, jsonb);
DROP FUNCTION IF EXISTS qbank.require_publish_ready();
DROP FUNCTION IF EXISTS qbank.enqueue_question_event(uuid, text, uuid, text, jsonb);
DROP FUNCTION IF EXISTS qbank.question_response(uuid, uuid);
DROP FUNCTION IF EXISTS qbank.question_version_summary(uuid);
DROP FUNCTION IF EXISTS qbank.apply_version_tags(uuid, jsonb);
DROP FUNCTION IF EXISTS qbank.require_read_context(text);
DROP FUNCTION IF EXISTS qbank.require_write_context(text);

ALTER TABLE qbank.question_versions
    DROP CONSTRAINT IF EXISTS question_versions_supported_languages_nonempty;
ALTER TABLE qbank.question_versions DROP COLUMN IF EXISTS version;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
    qbank.questions,
    qbank.question_versions,
    qbank.test_case_manifests,
    qbank.question_assets,
    qbank.tags,
    qbank.question_version_tags
TO aether_question_bank_app;

DROP INDEX IF EXISTS app.outbox_events_ready_idx;
ALTER TABLE app.outbox_events
    DROP CONSTRAINT IF EXISTS outbox_events_payload_sha256_check;
ALTER TABLE app.outbox_events DROP COLUMN IF EXISTS payload_sha256;
ALTER TABLE app.outbox_events RENAME COLUMN event_id TO id;
ALTER TABLE app.outbox_events RENAME COLUMN next_attempt_at TO available_at;
ALTER TABLE app.outbox_events RENAME COLUMN publication_attempts TO publish_attempts;
ALTER TABLE app.outbox_events RENAME COLUMN locked_until TO locked_at;
UPDATE app.outbox_events
SET locked_at = NULL
WHERE locked_at IS NOT NULL;
ALTER TABLE app.outbox_events ADD COLUMN lock_token uuid;
ALTER TABLE app.outbox_events
    ADD CONSTRAINT outbox_events_lock_token_check
    CHECK ((locked_at IS NULL) = (lock_token IS NULL));
CREATE INDEX outbox_events_ready_idx
    ON app.outbox_events (available_at, occurred_at)
    WHERE published_at IS NULL;

RESET ROLE;
