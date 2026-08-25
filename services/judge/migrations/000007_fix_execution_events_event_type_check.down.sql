-- File: services/judge/migrations/000007_fix_execution_events_event_type_check.down.sql
-- NOT VALID: this re-adds the original (broken) regex shape without
-- validating it against existing rows. A plain ADD CONSTRAINT would make
-- Postgres check every existing row, and any real 'execution.accepted.v1'
-- row written since the up migration would violate the broken regex,
-- failing `migrate down` and leaving schema_migrations.dirty = true. A down
-- migration only needs to revert the schema shape, not re-validate history.
SET ROLE aether_judge_migrator;

ALTER TABLE judge.execution_events
    DROP CONSTRAINT execution_events_event_type_check;
ALTER TABLE judge.execution_events
    ADD CONSTRAINT execution_events_event_type_check
        CHECK (event_type ~ '^execution\\.[a-z_]+\\.v1$') NOT VALID;

RESET ROLE;
