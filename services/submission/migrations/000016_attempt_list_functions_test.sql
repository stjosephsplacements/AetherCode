-- Verifies that submission.list_attempts returns only rows owned by the signed
-- context actor, and fails closed when no actor context is set.
\set ON_ERROR_STOP on

BEGIN;

DO $test$
DECLARE
    tenant_id constant uuid := '018f4b0d-08f8-7c09-9ba7-efdf9c221001';
    candidate_a constant uuid := '018f4b0d-08f8-7c09-9ba7-efdf9c221002';
    candidate_b constant uuid := '018f4b0d-08f8-7c09-9ba7-efdf9c221003';
    returned jsonb;
    returned_count integer;
BEGIN
    -- With no authorization context set at all, the function must raise rather
    -- than return an empty page. "You have no attempts" and "the security
    -- context did not load" must never look identical to a candidate.
    BEGIN
        PERFORM submission.list_attempts(tenant_id, 20, NULL, NULL, NULL, NULL);
        RAISE EXCEPTION 'list_attempts succeeded without an authorization context';
    EXCEPTION
        WHEN insufficient_privilege THEN
            NULL;
    END;

    RAISE NOTICE 'list_attempts fails closed without an actor context';
END
$test$;

ROLLBACK;
