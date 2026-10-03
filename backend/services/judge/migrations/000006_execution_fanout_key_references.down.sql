-- File: services/judge/migrations/000006_execution_fanout_key_references.down.sql
SET ROLE aether_judge_migrator;

ALTER TABLE judge.execution_jobs
    DROP COLUMN IF EXISTS evaluation_bundle_key_reference;

ALTER TABLE judge.execution_units
    DROP COLUMN IF EXISTS encryption_key_reference;

RESET ROLE;
