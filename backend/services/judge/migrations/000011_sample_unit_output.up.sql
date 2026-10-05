-- File: services/judge/migrations/000011_sample_unit_output.up.sql
-- A job on a sample bundle returns what each test produced (ADR-0021). The
-- bundle's visibility is recorded on the job at fan-out; as each unit's
-- verdict is recorded, its output is encrypted into object storage and the
-- unit keeps the reference, checksum and key reference, all or none. No
-- output plaintext is stored here, and no other job ever has a reference.

SET ROLE aether_judge_migrator;

ALTER TABLE judge.execution_jobs
    ADD COLUMN returns_output boolean NOT NULL DEFAULT false;

ALTER TABLE judge.execution_units
    ADD COLUMN raw_result_key_reference text
        CHECK (raw_result_key_reference IS NULL OR length(raw_result_key_reference) BETWEEN 1 AND 1024),
    DROP CONSTRAINT execution_units_result_reference_check,
    ADD CONSTRAINT execution_units_result_reference_check CHECK (
        (raw_result_ciphertext_ref IS NULL) = (raw_result_sha256 IS NULL)
        AND (raw_result_ciphertext_ref IS NULL) = (raw_result_key_reference IS NULL)
    );

RESET ROLE;
