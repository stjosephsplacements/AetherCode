SET ROLE aether_submission_owner;

DROP FUNCTION submission.record_code_run_completion(uuid, uuid, uuid, text, jsonb);
DROP FUNCTION submission.code_run_for_job(uuid);
DROP FUNCTION submission.mark_code_run_failed(uuid, uuid, text);
DROP FUNCTION submission.mark_code_run_dispatched(uuid, uuid, uuid);
DROP FUNCTION submission.claim_code_runs(integer, integer);
DROP FUNCTION submission.list_code_runs(uuid, uuid, uuid, integer, timestamptz, uuid);
DROP FUNCTION submission.get_code_run(uuid, uuid, uuid);
DROP FUNCTION submission.start_code_run(uuid, uuid, uuid, uuid, text, text, text, text);

DROP INDEX submission.code_runs_judge_job_idx;
DROP INDEX submission.code_runs_dispatch_idx;

ALTER TABLE submission.code_run_units
    DROP COLUMN compile_output,
    DROP COLUMN stdin;

ALTER TABLE submission.code_runs
    DROP CONSTRAINT code_runs_dispatched_at_check,
    DROP COLUMN failure_code,
    DROP COLUMN verdict,
    DROP COLUMN dispatched_at,
    DROP COLUMN dispatch_after,
    DROP COLUMN dispatch_attempts;

RESET ROLE;
