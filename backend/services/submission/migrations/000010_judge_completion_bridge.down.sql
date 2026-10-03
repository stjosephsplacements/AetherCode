SET ROLE aether_submission_owner;

DO $rollback_guard$
BEGIN
    IF EXISTS (SELECT 1 FROM submission.judge_completion_ingress) THEN
        RAISE EXCEPTION 'cannot roll back Judge completion bridge while durable completion ingress records exist';
    END IF;
END
$rollback_guard$;

REVOKE ALL ON FUNCTION submission.ingest_judge_completion(
    uuid, uuid, uuid, uuid, text, uuid, uuid, text, integer, integer, text, text, text, timestamptz
) FROM aether_submission_judge_adapter;
REVOKE USAGE ON SCHEMA submission FROM aether_submission_judge_adapter;
DROP FUNCTION IF EXISTS submission.ingest_judge_completion(
    uuid, uuid, uuid, uuid, text, uuid, uuid, text, integer, integer, text, text, text, timestamptz
);
DROP TABLE IF EXISTS submission.judge_completion_ingress_deliveries;
DROP TABLE IF EXISTS submission.judge_completion_ingress;

RESET ROLE;
