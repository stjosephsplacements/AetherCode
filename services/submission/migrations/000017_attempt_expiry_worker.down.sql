SET ROLE aether_submission_owner;

DO $revoke$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aether_submission_expiry_worker') THEN
        REVOKE EXECUTE ON FUNCTION submission.expire_overdue_attempts(integer)
            FROM aether_submission_expiry_worker;
        REVOKE USAGE ON SCHEMA submission, app FROM aether_submission_expiry_worker;
    END IF;
END
$revoke$;

DROP INDEX IF EXISTS submission.attempts_expiry_scan_idx;
DROP FUNCTION IF EXISTS submission.expire_overdue_attempts(integer);

RESET ROLE;
