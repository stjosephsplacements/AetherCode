-- File: services/seb/migrations/000011_rls_block_deletes_test.sql
-- Test that RLS policies correctly block DELETE and allow app.hard_delete()

-- Setup: Create test data
SET ROLE aether_seb_owner;

INSERT INTO seb.configurations (id, tenant_id, assessment_id, config_key_hash, seb_config_json, quit_password_hash, active_from, active_until)
VALUES
    ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333', 'hash1', '{"test": true}', 'quit_hash1', NOW(), NOW() + INTERVAL '1 day'),
    ('44444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222', '55555555-5555-5555-5555-555555555555', 'hash2', '{"test": true}', 'quit_hash2', NOW(), NOW() + INTERVAL '1 day');

INSERT INTO seb.sessions (id, tenant_id, configuration_id, user_id, browser_exam_key, session_token, started_at, status)
VALUES
    ('66666666-6666-6666-6666-666666666666', '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', '77777777-7777-7777-7777-777777777777', 'bek1', 'token1', NOW(), 'active'),
    ('88888888-8888-8888-8888-888888888888', '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', '99999999-9999-9999-9999-999999999999', 'bek2', 'token2', NOW(), 'active');

RESET ROLE;

-- Test 1: Direct DELETE should fail for app role
SET ROLE aether_seb_app;

DO $$
BEGIN
    DELETE FROM seb.configurations WHERE id = '11111111-1111-1111-1111-111111111111';
    RAISE EXCEPTION 'TEST FAILED: DELETE should have been blocked by RLS policy';
EXCEPTION
    WHEN insufficient_privilege THEN
        RAISE NOTICE 'TEST PASSED: configurations DELETE blocked by RLS';
END $$;

DO $$
BEGIN
    DELETE FROM seb.sessions WHERE id = '66666666-6666-6666-6666-666666666666';
    RAISE EXCEPTION 'TEST FAILED: DELETE should have been blocked by RLS policy';
EXCEPTION
    WHEN insufficient_privilege THEN
        RAISE NOTICE 'TEST PASSED: sessions DELETE blocked by RLS';
END $$;

RESET ROLE;

-- Test 2: app.hard_delete() should succeed (requires super_admin role setup)
SET ROLE aether_seb_owner;

-- Grant super_admin_role to owner for testing
GRANT super_admin_role TO aether_seb_owner;

-- Test hard delete for configurations
SELECT app.hard_delete(
    'seb.configurations',
    '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
    'Test hard delete via SECURITY DEFINER function'
);

-- Verify record was deleted
DO $$
DECLARE
    v_count int;
BEGIN
    SELECT COUNT(*) INTO v_count FROM seb.configurations WHERE id = '11111111-1111-1111-1111-111111111111';
    IF v_count = 0 THEN
        RAISE NOTICE 'TEST PASSED: configurations hard delete succeeded';
    ELSE
        RAISE EXCEPTION 'TEST FAILED: configurations record still exists after hard delete';
    END IF;
END $$;

-- Test hard delete for sessions
SELECT app.hard_delete(
    'seb.sessions',
    '66666666-6666-6666-6666-666666666666',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
    'Test hard delete via SECURITY DEFINER function'
);

-- Verify record was deleted
DO $$
DECLARE
    v_count int;
BEGIN
    SELECT COUNT(*) INTO v_count FROM seb.sessions WHERE id = '66666666-6666-6666-6666-666666666666';
    IF v_count = 0 THEN
        RAISE NOTICE 'TEST PASSED: sessions hard delete succeeded';
    ELSE
        RAISE EXCEPTION 'TEST FAILED: sessions record still exists after hard delete';
    END IF;
END $$;

-- Verify audit log entries
DO $$
DECLARE
    v_count int;
BEGIN
    SELECT COUNT(*) INTO v_count FROM app.hard_delete_audit_log
    WHERE table_name IN ('seb.configurations', 'seb.sessions');
    IF v_count >= 2 THEN
        RAISE NOTICE 'TEST PASSED: audit log entries created';
    ELSE
        RAISE EXCEPTION 'TEST FAILED: expected at least 2 audit log entries, found %', v_count;
    END IF;
END $$;

-- Cleanup
DELETE FROM seb.sessions WHERE id = '88888888-8888-8888-8888-888888888888';
DELETE FROM seb.configurations WHERE id = '44444444-4444-4444-4444-444444444444';
DELETE FROM app.hard_delete_audit_log WHERE table_name IN ('seb.configurations', 'seb.sessions');

REVOKE super_admin_role FROM aether_seb_owner;

RESET ROLE;

-- Summary
SELECT 'All tests passed for seb RLS DELETE blocking' AS result;
