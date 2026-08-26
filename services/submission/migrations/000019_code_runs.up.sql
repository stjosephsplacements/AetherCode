-- Ephemeral candidate-facing "run code against sample tests" data. These
-- tables are structurally separate from the permanent grading record
-- (submission.evaluation_requests / judge_receipts / score_summaries): a run
-- never touches those tables, and its rows are purged after purge_after
-- rather than retained as grading evidence.
SET ROLE aether_submission_owner;

CREATE TABLE submission.code_runs (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    attempt_id uuid NOT NULL,
    exam_item_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    language_id text NOT NULL CHECK (length(language_id) BETWEEN 1 AND 80),
    source_object_key text NOT NULL CHECK (length(source_object_key) > 0),
    source_checksum char(64) NOT NULL CHECK (source_checksum ~* '^[0-9a-f]{64}$'),
    encryption_key_reference text NOT NULL CHECK (length(encryption_key_reference) > 0),
    judge_job_id uuid,
    lifecycle_state text NOT NULL DEFAULT 'queued'
        CHECK (lifecycle_state IN ('queued', 'dispatched', 'completed', 'failed', 'cancelled')),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at timestamptz,
    purge_after timestamptz NOT NULL,
    CHECK (
        lifecycle_state NOT IN ('completed', 'failed', 'cancelled')
        OR completed_at IS NOT NULL
    ),
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, attempt_id)
        REFERENCES submission.attempts (tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE submission.code_run_units (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    code_run_id uuid NOT NULL,
    unit_number integer NOT NULL CHECK (unit_number >= 0),
    verdict text NOT NULL
        CHECK (verdict IN ('accepted', 'wrong_answer', 'time_limit_exceeded', 'memory_limit_exceeded', 'runtime_error', 'compile_error', 'internal_error', 'cancelled')),
    stdout text,
    stderr text,
    expected_output text,
    execution_time_ms integer CHECK (execution_time_ms IS NULL OR execution_time_ms >= 0),
    memory_kib integer CHECK (memory_kib IS NULL OR memory_kib >= 0),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, code_run_id, unit_number),
    FOREIGN KEY (tenant_id, code_run_id)
        REFERENCES submission.code_runs (tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX code_runs_attempt_item_idx
    ON submission.code_runs (tenant_id, attempt_id, exam_item_id, created_at DESC);
CREATE INDEX code_runs_purge_idx
    ON submission.code_runs (purge_after)
    WHERE lifecycle_state IN ('completed', 'failed', 'cancelled');

ALTER TABLE submission.code_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission.code_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE submission.code_run_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission.code_run_units FORCE ROW LEVEL SECURITY;

-- Mirrors the RLS policy shape 000002 established for
-- submission.answer_revisions exactly (signed_read / signed_insert /
-- signed_update / signed_delete for aether_submission_app, plus an
-- unconditional owner_maintenance policy for aether_submission_owner),
-- substituting the table name. Only SELECT and INSERT are granted below,
-- matching answer_revisions' own grant set, but the update/delete policies
-- are still declared for shape parity in case a later task grants those
-- privileges.
DO $policies$
DECLARE
    protected_table text;
    policy_prefix text;
BEGIN
    FOREACH protected_table IN ARRAY ARRAY[
        'submission.code_runs',
        'submission.code_run_units'
    ]
    LOOP
        policy_prefix := replace(protected_table, '.', '_');
        EXECUTE format(
            'CREATE POLICY %I ON %s FOR SELECT TO aether_submission_app USING (authz.current_context_allows_read(tenant_id, %L, %L, %L))',
            policy_prefix || '_signed_read', protected_table,
            'submission.read', 'submission.write', protected_table
        );
        EXECUTE format(
            'CREATE POLICY %I ON %s FOR INSERT TO aether_submission_app WITH CHECK (authz.current_context_allows(tenant_id, %L, %L))',
            policy_prefix || '_signed_insert', protected_table,
            'submission.write', protected_table
        );
        EXECUTE format(
            'CREATE POLICY %I ON %s FOR UPDATE TO aether_submission_app USING (authz.current_context_allows(tenant_id, %L, %L)) WITH CHECK (authz.current_context_allows(tenant_id, %L, %L))',
            policy_prefix || '_signed_update', protected_table,
            'submission.write', protected_table, 'submission.write', protected_table
        );
        EXECUTE format(
            'CREATE POLICY %I ON %s FOR DELETE TO aether_submission_app USING (authz.current_context_allows(tenant_id, %L, %L))',
            policy_prefix || '_signed_delete', protected_table,
            'submission.write', protected_table
        );
        EXECUTE format(
            'CREATE POLICY %I ON %s FOR ALL TO aether_submission_owner USING (true) WITH CHECK (true)',
            policy_prefix || '_owner_maintenance', protected_table
        );
    END LOOP;
END
$policies$;

REVOKE ALL ON TABLE submission.code_runs, submission.code_run_units FROM PUBLIC;
GRANT SELECT, INSERT ON submission.code_runs TO aether_submission_app;
GRANT SELECT, INSERT ON submission.code_run_units TO aether_submission_app;

RESET ROLE;
