-- File: services/judge/migrations/000009_execution_decrypt_keys_and_weights.up.sql
-- Dispatch must decrypt the candidate source before handing it to the engine,
-- which needs the KMS key reference the source object was encrypted with. Like
-- evaluation_bundle_key_reference (000006) the column is nullable only because
-- rows predating it have no value; SubmitExecution validation requires it for
-- every new job, and dispatch fails loudly for a row without one.
--
-- request_ciphertext_ref has no consumer: nothing reads the object it points
-- at, so callers have no meaningful value to send. It becomes optional.
--
-- Each test case carries a scoring weight (evaluation bundle schema v2, 1..100;
-- v1 bundles weigh 1). Fan-out records it per unit so Pull can report it.

SET ROLE aether_judge_migrator;

ALTER TABLE judge.execution_jobs
    ADD COLUMN source_key_reference text
        CHECK (source_key_reference IS NULL OR length(source_key_reference) > 0);

ALTER TABLE judge.execution_jobs
    ALTER COLUMN request_ciphertext_ref DROP NOT NULL;

ALTER TABLE judge.execution_units
    ADD COLUMN weight integer NOT NULL DEFAULT 1 CHECK (weight BETWEEN 1 AND 100);

RESET ROLE;
