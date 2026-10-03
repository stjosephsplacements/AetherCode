SET ROLE aether_tenant_owner;

DROP SCHEMA IF EXISTS tenant CASCADE;
DROP TABLE IF EXISTS app.outbox_events;
DROP TABLE IF EXISTS app.command_idempotency;
DROP TABLE IF EXISTS app.inbox_messages;

RESET ROLE;
