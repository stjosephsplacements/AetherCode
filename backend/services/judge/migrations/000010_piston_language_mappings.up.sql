-- File: services/judge/migrations/000010_piston_language_mappings.up.sql
-- language_mappings is the deployment's list of languages Judge accepts
-- (SubmitExecution checks only that a key is present and enabled; each engine
-- adapter maps keys to its own runtimes). Deployments that run Piston
-- (ADR-0018) must be able to record that engine too.
SET ROLE aether_judge_migrator;

ALTER TABLE judge.language_mappings
    DROP CONSTRAINT language_mappings_engine_name_check,
    ADD CONSTRAINT language_mappings_engine_name_check CHECK (engine_name IN ('judge0', 'piston'));

RESET ROLE;
