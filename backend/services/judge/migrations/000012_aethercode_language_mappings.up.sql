-- Deployments that run the AetherCode Execution Engine (ADR-0028) record it
-- as the engine of their language mappings.
SET ROLE aether_judge_migrator;

ALTER TABLE judge.language_mappings
    DROP CONSTRAINT language_mappings_engine_name_check,
    ADD CONSTRAINT language_mappings_engine_name_check CHECK (engine_name IN ('judge0', 'piston', 'aethercode'));

RESET ROLE;
