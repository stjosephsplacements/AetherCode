SET ROLE aether_identity_owner;

DROP SCHEMA IF EXISTS identity CASCADE;
DROP TABLE IF EXISTS app.outbox_events;
DROP TABLE IF EXISTS app.command_idempotency;
DROP TABLE IF EXISTS app.inbox_messages;

RESET ROLE;
