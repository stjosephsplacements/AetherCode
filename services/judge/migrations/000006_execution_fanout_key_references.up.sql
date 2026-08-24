-- File: services/judge/migrations/000006_execution_fanout_key_references.up.sql
-- Fan-out (services/judge/internal/adapters/repo, Postgres.Submit) re-encrypts
-- each test case independently before storing it at test_case_ciphertext_ref,
-- so each unit needs its own KMS key reference to decrypt that object later.
-- No code path writes judge.execution_units yet, so this column can be added
-- NOT NULL directly, matching the encryption_key_reference column style used
-- throughout qbank (services/question-bank/migrations/000002_domain.up.sql).

SET ROLE aether_judge_migrator;

ALTER TABLE judge.execution_units
    ADD COLUMN encryption_key_reference text NOT NULL
        CHECK (length(encryption_key_reference) > 0);

-- Fan-out must also decrypt the *input* bundle before it can re-encrypt each
-- test case, which requires the KMS key reference the bundle was originally
-- encrypted with. Unlike execution_units above, judge.execution_jobs already
-- has one live writer (Postgres.Submit, via the SubmitExecutionRequest gRPC
-- contract in libs/proto), and that contract has no field carrying this
-- value yet (out of scope for this migration/task; see the fan-out plan's
-- Task 2 report for the follow-up needed on the proto contract). This column
-- is therefore nullable until that contract gains the field and callers
-- start populating it -- fan-out correctly fails with a real KMS error for
-- any job admitted without one, rather than silently mis-decrypting.
ALTER TABLE judge.execution_jobs
    ADD COLUMN evaluation_bundle_key_reference text
        CHECK (evaluation_bundle_key_reference IS NULL OR length(evaluation_bundle_key_reference) > 0);

RESET ROLE;
