-- File: services/judge/migrations/000005_rls_block_deletes_test.sql
-- Test that RLS policies correctly block DELETE and allow app.hard_delete()

-- Setup: Create test data
SET ROLE aether_judge_migrator;

INSERT INTO judge.execution_jobs (id, tenant_id, fairness_key, language, source_code, test_input, test_expected, status)
VALUES
    ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'test-fairness', 'python', 'print("test")', 'input', 'output', 'pending'),
    ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'test-fairness', 'java', 'System.out.println("test");', 'input', 'output', 'pending');

INSERT INTO judge.language_mappings (id, tenant_id, internal_language_name, judge0_language_id, description)
VALUES
    ('44444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222', 'python3', 71, 'Python 3.8'),
    ('55555555-5555-5555-5555-555555555555', '22222222-2222-2222-2222-222222222222', 'java', 62, 'Java 13');

RESET ROLE;

-- Test 1: Direct DELETE should fail for app role
SET ROLE aether_judge_app;

DO $$
BEGIN
    DELETE FROM judge.execution_jobs WHERE id = '11111111-1111-1111-1111-111111111111';
    RAISE EXCEPTION 'TEST FAILED: DELETE should have been blocked by RLS policy';
EXCEPTION
    WHEN insufficient_privilege THEN
        RAISE NOTICE 'TEST PASSED: execution_jobs DELETE blocked by RLS';
END $$;

DO $$
BEGIN
    DELETE FROM judge.language_mappings WHERE id = '44444444-4444-4444-4444-444444444444';
    RAISE EXCEPTION 'TEST FAILED: DELETE should have been blocked by RLS policy';
EXCEPTION
    WHEN insufficient_privilege THEN
        RAISE NOTICE 'TEST PASSED: language_mappings DELETE blocked by RLS';
END $$;

RESET ROLE;

-- Test 2: app.hard_delete() should succeed (requires super_admin role setup)
-- Note: This test assumes super_admin_role exists and test user is a member
-- In production, only SuperAdmin principals have this role

SET ROLE aether_judge_migrator;

-- Grant super_admin_role to owner for testing (in production, only specific principals have this)
GRANT super_admin_role TO aether_judge_migrator;

-- Test hard delete for execution_jobs
SELECT app.hard_delete(
    'judge.execution_jobs',
    '11111111-1111-1111-1111-111111111111',
    '99999999-9999-9999-9999-999999999999'::uuid,
    'Test hard delete via SECURITY DEFINER function'
);

-- Verify record was deleted
DO $$
DECLARE
    v_count int;
BEGIN
    SELECT COUNT(*) INTO v_count FROM judge.execution_jobs WHERE id = '11111111-1111-1111-1111-111111111111';
    IF v_count = 0 THEN
        RAISE NOTICE 'TEST PASSED: execution_jobs hard delete succeeded';
    ELSE
        RAISE EXCEPTION 'TEST FAILED: execution_jobs record still exists after hard delete';
    END IF;
END $$;

-- Test hard delete for language_mappings
SELECT app.hard_delete(
    'judge.language_mappings',
    '44444444-4444-4444-4444-444444444444',
    '99999999-9999-9999-9999-999999999999'::uuid,
    'Test hard delete via SECURITY DEFINER function'
);

-- Verify record was deleted
DO $$
DECLARE
    v_count int;
BEGIN
    SELECT COUNT(*) INTO v_count FROM judge.language_mappings WHERE id = '44444444-4444-4444-4444-444444444444';
    IF v_count = 0 THEN
        RAISE NOTICE 'TEST PASSED: language_mappings hard delete succeeded';
    ELSE
        RAISE EXCEPTION 'TEST FAILED: language_mappings record still exists after hard delete';
    END IF;
END $$;

-- Verify audit log entries
DO $$
DECLARE
    v_count int;
BEGIN
    SELECT COUNT(*) INTO v_count FROM app.hard_delete_audit_log
    WHERE table_name IN ('judge.execution_jobs', 'judge.language_mappings');
    IF v_count >= 2 THEN
        RAISE NOTICE 'TEST PASSED: audit log entries created';
    ELSE
        RAISE EXCEPTION 'TEST FAILED: expected at least 2 audit log entries, found %', v_count;
    END IF;
END $$;

-- Cleanup
DELETE FROM judge.execution_jobs WHERE id = '33333333-3333-3333-3333-333333333333';
DELETE FROM judge.language_mappings WHERE id = '55555555-5555-5555-5555-555555555555';
DELETE FROM app.hard_delete_audit_log WHERE table_name IN ('judge.execution_jobs', 'judge.language_mappings');

REVOKE super_admin_role FROM aether_judge_migrator;

RESET ROLE;

-- Summary
SELECT 'All tests passed for judge RLS DELETE blocking' AS result;
