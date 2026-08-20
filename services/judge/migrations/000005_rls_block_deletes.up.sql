-- File: services/judge/migrations/000005_rls_block_deletes.up.sql
-- Gap #3 (CRITICAL): Database layer enforcement for soft delete
-- Block DELETE operations via RLS - force all deletes through SECURITY DEFINER app.hard_delete()

SET ROLE aether_judge_migrator;

-- Enable RLS on all soft-delete tables
ALTER TABLE judge.execution_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE judge.language_mappings ENABLE ROW LEVEL SECURITY;

-- Grant DELETE privilege to app role (required for RLS to be checked)
-- RLS policy will then block it - defense in depth
GRANT DELETE ON judge.execution_jobs TO aether_judge_app;
GRANT DELETE ON judge.language_mappings TO aether_judge_app;

-- Create permissive policies for normal operations (SELECT, INSERT, UPDATE)
CREATE POLICY allow_all_reads ON judge.execution_jobs
    FOR SELECT TO aether_judge_app USING (true);
CREATE POLICY allow_all_inserts ON judge.execution_jobs
    FOR INSERT TO aether_judge_app WITH CHECK (true);
CREATE POLICY allow_all_updates ON judge.execution_jobs
    FOR UPDATE TO aether_judge_app USING (true);

CREATE POLICY allow_all_reads ON judge.language_mappings
    FOR SELECT TO aether_judge_app USING (true);
CREATE POLICY allow_all_inserts ON judge.language_mappings
    FOR INSERT TO aether_judge_app WITH CHECK (true);
CREATE POLICY allow_all_updates ON judge.language_mappings
    FOR UPDATE TO aether_judge_app USING (true);

-- Block all DELETE statements for application role via RLS
-- app.hard_delete() uses SECURITY DEFINER which bypasses RLS
CREATE POLICY block_delete_require_hard_delete_function ON judge.execution_jobs
    FOR DELETE TO aether_judge_app USING (false);

CREATE POLICY block_delete_require_hard_delete_function ON judge.language_mappings
    FOR DELETE TO aether_judge_app USING (false);

COMMENT ON POLICY block_delete_require_hard_delete_function ON judge.execution_jobs IS
    'RLS enforcement: DELETE blocked for app role - must use app.hard_delete() SECURITY DEFINER function';

COMMENT ON POLICY block_delete_require_hard_delete_function ON judge.language_mappings IS
    'RLS enforcement: DELETE blocked for app role - must use app.hard_delete() SECURITY DEFINER function';

RESET ROLE;
