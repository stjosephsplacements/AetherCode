-- File: services/analytics/migrations/000013_rls_block_deletes_test.sql
-- Test that RLS policies correctly block DELETE and allow app.hard_delete()

-- Setup: Create test data
SET ROLE aether_analytics_owner;

INSERT INTO analytics.report_exports (id, tenant_id, report_type, generated_by, format, status, file_url)
VALUES
    ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'student_progress', '33333333-3333-3333-3333-333333333333', 'pdf', 'completed', 'https://example.com/report1.pdf'),
    ('44444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222', 'exam_results', '55555555-5555-5555-5555-555555555555', 'csv', 'completed', 'https://example.com/report2.csv');

RESET ROLE;

-- Test 1: Direct DELETE should fail for app role
SET ROLE aether_analytics_app;

DO $$
BEGIN
    DELETE FROM analytics.report_exports WHERE id = '11111111-1111-1111-1111-111111111111';
    RAISE EXCEPTION 'TEST FAILED: DELETE should have been blocked by RLS policy';
EXCEPTION
    WHEN insufficient_privilege THEN
        RAISE NOTICE 'TEST PASSED: report_exports DELETE blocked by RLS';
END $$;

RESET ROLE;

-- Test 2: app.hard_delete() should succeed (requires super_admin role setup)
SET ROLE aether_analytics_owner;

-- Grant super_admin_role to owner for testing
GRANT super_admin_role TO aether_analytics_owner;

-- Test hard delete for report_exports
SELECT app.hard_delete(
    'analytics.report_exports',
    '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
    'Test hard delete via SECURITY DEFINER function'
);

-- Verify record was deleted
DO $$
DECLARE
    v_count int;
BEGIN
    SELECT COUNT(*) INTO v_count FROM analytics.report_exports WHERE id = '11111111-1111-1111-1111-111111111111';
    IF v_count = 0 THEN
        RAISE NOTICE 'TEST PASSED: report_exports hard delete succeeded';
    ELSE
        RAISE EXCEPTION 'TEST FAILED: report_exports record still exists after hard delete';
    END IF;
END $$;

-- Verify audit log entry
DO $$
DECLARE
    v_count int;
BEGIN
    SELECT COUNT(*) INTO v_count FROM app.hard_delete_audit_log
    WHERE table_name = 'analytics.report_exports';
    IF v_count >= 1 THEN
        RAISE NOTICE 'TEST PASSED: audit log entry created';
    ELSE
        RAISE EXCEPTION 'TEST FAILED: expected at least 1 audit log entry, found %', v_count;
    END IF;
END $$;

-- Cleanup
DELETE FROM analytics.report_exports WHERE id = '44444444-4444-4444-4444-444444444444';
DELETE FROM app.hard_delete_audit_log WHERE table_name = 'analytics.report_exports';

REVOKE super_admin_role FROM aether_analytics_owner;

RESET ROLE;

-- Summary
SELECT 'All tests passed for analytics RLS DELETE blocking' AS result;
