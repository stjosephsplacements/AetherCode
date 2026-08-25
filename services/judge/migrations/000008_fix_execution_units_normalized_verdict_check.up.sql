-- File: services/judge/migrations/000008_fix_execution_units_normalized_verdict_check.up.sql
-- 000001_judge_control_schema.up.sql spelled the compile-error member of
-- judge.execution_units.normalized_verdict's vocabulary as 'compilation_error',
-- but every other writer/reader of this exact vocabulary uses 'compile_error':
--   - services/judge/internal/adapters/judge0/client.go maps Judge0 status
--     ID 6 to the Go string "compile_error", which dispatcher.UnitVerdict.Status
--     carries straight into DispatchStoreAdapter.RecordVerdict's UPDATE of
--     this column.
--   - judge.outbox_events' completion-contract trigger
--     (000003_completion_contract_integrity.up.sql) only accepts 'compile_error'
--     in its payload->>'verdict' check.
--   - services/judge/internal/app/service.go's isCompletionVerdict and
--     services/judge/internal/adapters/grpc/server.go's completionVerdictCode
--     both only recognize 'compile_error'.
-- 'compilation_error' is therefore unreachable dead vocabulary and, worse, a
-- real compile-error verdict from the engine can never be recorded on a unit
-- today: RecordVerdict's UPDATE violates this CHECK constraint the moment a
-- unit actually fails to compile. Fix the constraint to accept the vocabulary
-- every writer and reader already uses.

SET ROLE aether_judge_migrator;

ALTER TABLE judge.execution_units
    DROP CONSTRAINT execution_units_normalized_verdict_check;
ALTER TABLE judge.execution_units
    ADD CONSTRAINT execution_units_normalized_verdict_check
        CHECK (normalized_verdict IN (
            'accepted', 'wrong_answer', 'time_limit_exceeded', 'memory_limit_exceeded',
            'runtime_error', 'compile_error', 'internal_error', 'cancelled'
        ));

RESET ROLE;
