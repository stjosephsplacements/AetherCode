SET ROLE aether_judge_migrator;

DO $block$
BEGIN
    IF EXISTS (SELECT 1 FROM judge.execution_jobs WHERE client_subject <> 'submission') THEN
        RAISE EXCEPTION 'jobs from other clients exist; remove them before reverting 000013';
    END IF;
END
$block$;
ALTER TABLE judge.execution_jobs DROP COLUMN client_subject;

RESET ROLE;
