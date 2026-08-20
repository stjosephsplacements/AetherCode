-- File: services/notification/migrations/000011_rls_block_deletes_test.sql
-- Test that RLS policies correctly block DELETE and allow app.hard_delete()

-- Setup: Create test data
SET ROLE aether_notification_owner;

INSERT INTO notification.recipient_preferences (id, tenant_id, user_id, channel, enabled)
VALUES
    ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333', 'email', true),
    ('44444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222', '55555555-5555-5555-5555-555555555555', 'sms', true);

INSERT INTO notification.notifications (id, tenant_id, recipient_id, template_id, channel, payload, status)
VALUES
    ('66666666-6666-6666-6666-666666666666', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333', 'template1', 'email', '{"test": true}', 'pending'),
    ('77777777-7777-7777-7777-777777777777', '22222222-2222-2222-2222-222222222222', '55555555-5555-5555-5555-555555555555', 'template2', 'sms', '{"test": true}', 'pending');

INSERT INTO notification.provider_idempotency_records (id, tenant_id, notification_id, provider_name, provider_message_id, idempotency_key)
VALUES
    ('88888888-8888-8888-8888-888888888888', '22222222-2222-2222-2222-222222222222', '66666666-6666-6666-6666-666666666666', 'sendgrid', 'msg1', 'key1'),
    ('99999999-9999-9999-9999-999999999999', '22222222-2222-2222-2222-222222222222', '77777777-7777-7777-7777-777777777777', 'twilio', 'msg2', 'key2');

RESET ROLE;

-- Test 1: Direct DELETE should fail for app role
SET ROLE aether_notification_app;

DO $$
BEGIN
    DELETE FROM notification.recipient_preferences WHERE id = '11111111-1111-1111-1111-111111111111';
    RAISE EXCEPTION 'TEST FAILED: DELETE should have been blocked by RLS policy';
EXCEPTION
    WHEN insufficient_privilege THEN
        RAISE NOTICE 'TEST PASSED: recipient_preferences DELETE blocked by RLS';
END $$;

DO $$
BEGIN
    DELETE FROM notification.notifications WHERE id = '66666666-6666-6666-6666-666666666666';
    RAISE EXCEPTION 'TEST FAILED: DELETE should have been blocked by RLS policy';
EXCEPTION
    WHEN insufficient_privilege THEN
        RAISE NOTICE 'TEST PASSED: notifications DELETE blocked by RLS';
END $$;

DO $$
BEGIN
    DELETE FROM notification.provider_idempotency_records WHERE id = '88888888-8888-8888-8888-888888888888';
    RAISE EXCEPTION 'TEST FAILED: DELETE should have been blocked by RLS policy';
EXCEPTION
    WHEN insufficient_privilege THEN
        RAISE NOTICE 'TEST PASSED: provider_idempotency_records DELETE blocked by RLS';
END $$;

RESET ROLE;

-- Test 2: app.hard_delete() should succeed (requires super_admin role setup)
SET ROLE aether_notification_owner;

-- Grant super_admin_role to owner for testing
GRANT super_admin_role TO aether_notification_owner;

-- Test hard delete for recipient_preferences
SELECT app.hard_delete(
    'notification.recipient_preferences',
    '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
    'Test hard delete via SECURITY DEFINER function'
);

-- Verify record was deleted
DO $$
DECLARE
    v_count int;
BEGIN
    SELECT COUNT(*) INTO v_count FROM notification.recipient_preferences WHERE id = '11111111-1111-1111-1111-111111111111';
    IF v_count = 0 THEN
        RAISE NOTICE 'TEST PASSED: recipient_preferences hard delete succeeded';
    ELSE
        RAISE EXCEPTION 'TEST FAILED: recipient_preferences record still exists after hard delete';
    END IF;
END $$;

-- Test hard delete for notifications
SELECT app.hard_delete(
    'notification.notifications',
    '66666666-6666-6666-6666-666666666666',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
    'Test hard delete via SECURITY DEFINER function'
);

-- Verify record was deleted
DO $$
DECLARE
    v_count int;
BEGIN
    SELECT COUNT(*) INTO v_count FROM notification.notifications WHERE id = '66666666-6666-6666-6666-666666666666';
    IF v_count = 0 THEN
        RAISE NOTICE 'TEST PASSED: notifications hard delete succeeded';
    ELSE
        RAISE EXCEPTION 'TEST FAILED: notifications record still exists after hard delete';
    END IF;
END $$;

-- Test hard delete for provider_idempotency_records
SELECT app.hard_delete(
    'notification.provider_idempotency_records',
    '88888888-8888-8888-8888-888888888888',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
    'Test hard delete via SECURITY DEFINER function'
);

-- Verify record was deleted
DO $$
DECLARE
    v_count int;
BEGIN
    SELECT COUNT(*) INTO v_count FROM notification.provider_idempotency_records WHERE id = '88888888-8888-8888-8888-888888888888';
    IF v_count = 0 THEN
        RAISE NOTICE 'TEST PASSED: provider_idempotency_records hard delete succeeded';
    ELSE
        RAISE EXCEPTION 'TEST FAILED: provider_idempotency_records record still exists after hard delete';
    END IF;
END $$;

-- Verify audit log entries
DO $$
DECLARE
    v_count int;
BEGIN
    SELECT COUNT(*) INTO v_count FROM app.hard_delete_audit_log
    WHERE table_name IN ('notification.recipient_preferences', 'notification.notifications', 'notification.provider_idempotency_records');
    IF v_count >= 3 THEN
        RAISE NOTICE 'TEST PASSED: audit log entries created';
    ELSE
        RAISE EXCEPTION 'TEST FAILED: expected at least 3 audit log entries, found %', v_count;
    END IF;
END $$;

-- Cleanup
DELETE FROM notification.provider_idempotency_records WHERE id = '99999999-9999-9999-9999-999999999999';
DELETE FROM notification.notifications WHERE id = '77777777-7777-7777-7777-777777777777';
DELETE FROM notification.recipient_preferences WHERE id = '44444444-4444-4444-4444-444444444444';
DELETE FROM app.hard_delete_audit_log WHERE table_name IN ('notification.recipient_preferences', 'notification.notifications', 'notification.provider_idempotency_records');

REVOKE super_admin_role FROM aether_notification_owner;

RESET ROLE;

-- Summary
SELECT 'All tests passed for notification RLS DELETE blocking' AS result;
