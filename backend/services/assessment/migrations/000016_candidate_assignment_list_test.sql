-- Verifies that assessment.list_candidate_assignments fails closed when no
-- signed actor context is present.
\set ON_ERROR_STOP on

BEGIN;

DO $test$
DECLARE
    tenant_id constant uuid := '018f4b0d-08f8-7c09-9ba7-efdf9c222001';
BEGIN
    BEGIN
        PERFORM assessment.list_candidate_assignments(tenant_id, 20, NULL, NULL, NULL);
        RAISE EXCEPTION 'list_candidate_assignments succeeded without an authorization context';
    EXCEPTION
        WHEN insufficient_privilege THEN
            NULL;
    END;

    RAISE NOTICE 'list_candidate_assignments fails closed without an actor context';
END
$test$;

ROLLBACK;
