-- File: services/judge/migrations/000005_rls_block_deletes.down.sql
-- Rollback RLS DELETE blocking policies

SET ROLE aether_judge_migrator;

-- Drop RLS policies for execution_jobs
DROP POLICY IF EXISTS allow_all_reads ON judge.execution_jobs;
DROP POLICY IF EXISTS allow_all_inserts ON judge.execution_jobs;
DROP POLICY IF EXISTS allow_all_updates ON judge.execution_jobs;
DROP POLICY IF EXISTS block_delete_require_hard_delete_function ON judge.execution_jobs;

-- Drop RLS policies for language_mappings
DROP POLICY IF EXISTS allow_all_reads ON judge.language_mappings;
DROP POLICY IF EXISTS allow_all_inserts ON judge.language_mappings;
DROP POLICY IF EXISTS allow_all_updates ON judge.language_mappings;
DROP POLICY IF EXISTS block_delete_require_hard_delete_function ON judge.language_mappings;

-- Revoke DELETE privileges
REVOKE DELETE ON judge.execution_jobs FROM aether_judge_app;
REVOKE DELETE ON judge.language_mappings FROM aether_judge_app;

-- Disable RLS
ALTER TABLE judge.execution_jobs DISABLE ROW LEVEL SECURITY;
ALTER TABLE judge.language_mappings DISABLE ROW LEVEL SECURITY;

RESET ROLE;
