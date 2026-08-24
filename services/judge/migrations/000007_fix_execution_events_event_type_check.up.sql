-- File: services/judge/migrations/000007_fix_execution_events_event_type_check.up.sql
-- 000001_judge_control_schema.up.sql defined
-- judge.execution_events.event_type's CHECK using a plain (non-E) SQL string
-- literal containing '\\.', which -- because standard_conforming_strings is
-- on by default -- is two literal backslash characters, not an escaped dot.
-- The resulting POSIX regex '^execution\\.[a-z_]+\\.v1$' therefore requires a
-- literal backslash character before each dot and never matches any real
-- event_type Postgres.Submit writes (e.g. 'execution.accepted.v1'), so every
-- Submit call that reaches the execution_events insert fails with a check
-- constraint violation. This was never caught because no earlier test
-- exercised that INSERT against a real database. Fix the regex to a single
-- backslash, which matches the same 'execution.<word>.v1' shape the rest of
-- the codebase (see judge.outbox_events' identical convention) intends.

SET ROLE aether_judge_migrator;

ALTER TABLE judge.execution_events
    DROP CONSTRAINT execution_events_event_type_check;
ALTER TABLE judge.execution_events
    ADD CONSTRAINT execution_events_event_type_check
        CHECK (event_type ~ '^execution\.[a-z_]+\.v1$');

RESET ROLE;
