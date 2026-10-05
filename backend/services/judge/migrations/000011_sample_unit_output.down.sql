-- File: services/judge/migrations/000011_sample_unit_output.down.sql
SET ROLE aether_judge_migrator;

ALTER TABLE judge.execution_units
    DROP CONSTRAINT execution_units_result_reference_check,
    DROP COLUMN raw_result_key_reference,
    ADD CONSTRAINT execution_units_result_reference_check CHECK (
        raw_result_sha256 IS NULL OR raw_result_ciphertext_ref IS NOT NULL
    );

ALTER TABLE judge.execution_jobs
    DROP COLUMN returns_output;

RESET ROLE;
