-- File: services/judge/migrations/000009_execution_decrypt_keys_and_weights.down.sql
SET ROLE aether_judge_migrator;

ALTER TABLE judge.execution_units
    DROP COLUMN IF EXISTS weight;

-- Restoring NOT NULL needs a value for rows created without a request
-- reference; 'unspecified' is a placeholder that no reader dereferences.
UPDATE judge.execution_jobs
SET request_ciphertext_ref = 'unspecified'
WHERE request_ciphertext_ref IS NULL;
ALTER TABLE judge.execution_jobs
    ALTER COLUMN request_ciphertext_ref SET NOT NULL;

ALTER TABLE judge.execution_jobs
    DROP COLUMN IF EXISTS source_key_reference;

RESET ROLE;
