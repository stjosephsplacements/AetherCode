-- File: services/judge/migrations/000008_fix_execution_units_normalized_verdict_check.down.sql
-- NOT VALID: this re-adds the original (broken) vocabulary without
-- validating it against existing rows. A plain ADD CONSTRAINT would make
-- Postgres check every existing row, and any real 'compile_error' row
-- written since the up migration would violate the reverted constraint,
-- failing `migrate down` and leaving schema_migrations.dirty = true. A down
-- migration only needs to revert the schema shape, not re-validate history.
SET ROLE aether_judge_migrator;

ALTER TABLE judge.execution_units
    DROP CONSTRAINT execution_units_normalized_verdict_check;
ALTER TABLE judge.execution_units
    ADD CONSTRAINT execution_units_normalized_verdict_check
        CHECK (normalized_verdict IN (
            'accepted', 'wrong_answer', 'time_limit_exceeded', 'memory_limit_exceeded',
            'runtime_error', 'compilation_error', 'internal_error', 'cancelled'
        )) NOT VALID;

RESET ROLE;
