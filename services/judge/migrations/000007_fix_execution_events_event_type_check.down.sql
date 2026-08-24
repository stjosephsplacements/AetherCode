-- File: services/judge/migrations/000007_fix_execution_events_event_type_check.down.sql
SET ROLE aether_judge_migrator;

ALTER TABLE judge.execution_events
    DROP CONSTRAINT execution_events_event_type_check;
ALTER TABLE judge.execution_events
    ADD CONSTRAINT execution_events_event_type_check
        CHECK (event_type ~ '^execution\\.[a-z_]+\\.v1$');

RESET ROLE;
