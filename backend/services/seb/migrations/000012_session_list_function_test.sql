-- Verifies that seb.list_sessions fails closed without a signed actor context.
\set ON_ERROR_STOP on

BEGIN;

DO $test$
DECLARE
    tenant_id constant uuid := '018f4b0d-08f8-7c09-9ba7-efdf9c223001';
BEGIN
    BEGIN
        PERFORM seb.list_sessions(tenant_id, 20, NULL, NULL, NULL);
        RAISE EXCEPTION 'list_sessions succeeded without an authorization context';
    EXCEPTION
        WHEN insufficient_privilege THEN
            NULL;
    END;

    RAISE NOTICE 'list_sessions fails closed without an actor context';
END
$test$;

ROLLBACK;
