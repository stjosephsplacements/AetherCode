-- Completions are partitioned by caller (ADR-0033). Each job records the mTLS
-- subject of the service that submitted it; a service pulls and acknowledges
-- only its own jobs' completions, so a second client (Question Bank's model
-- solution checks) cannot take Submission's grading results. Existing jobs
-- came from Submission.
SET ROLE aether_judge_migrator;

ALTER TABLE judge.execution_jobs
    ADD COLUMN client_subject text NOT NULL DEFAULT 'submission'
        CHECK (client_subject ~ '^[a-z][a-z0-9-]{0,62}$');

RESET ROLE;
