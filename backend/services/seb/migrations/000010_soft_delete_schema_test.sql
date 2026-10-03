-- Test script for soft delete schema migration (000010)
-- Run this after applying the up migration to validate behavior
-- Usage: psql -U aether_seb_owner -d aethercode -f 000010_soft_delete_schema_test.sql

SET ROLE aether_seb_owner;

BEGIN;

-- Test 1: Verify columns exist
DO $$
BEGIN
    -- Check configurations
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'seb' AND table_name = 'configurations'
        AND column_name IN ('deleted_at', 'deleted_by', 'deletion_reason')
    ) THEN
        RAISE EXCEPTION 'configurations soft delete columns missing';
    END IF;

    -- Check sessions
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'seb' AND table_name = 'sessions'
        AND column_name IN ('deleted_at', 'deleted_by', 'deletion_reason')
    ) THEN
        RAISE EXCEPTION 'sessions soft delete columns missing';
    END IF;

    RAISE NOTICE 'Test 1 PASSED: Soft delete columns exist';
END $$;

-- Test 2: Verify indexes exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'seb' AND indexname = 'configurations_deleted_at_idx'
    ) THEN
        RAISE EXCEPTION 'configurations_deleted_at_idx missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'seb' AND indexname = 'sessions_deleted_at_idx'
    ) THEN
        RAISE EXCEPTION 'sessions_deleted_at_idx missing';
    END IF;

    RAISE NOTICE 'Test 2 PASSED: Indexes exist';
END $$;

-- Test 3: Verify hard_delete function exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'app' AND p.proname = 'hard_delete'
    ) THEN
        RAISE EXCEPTION 'app.hard_delete function missing';
    END IF;

    RAISE NOTICE 'Test 3 PASSED: hard_delete function exists';
END $$;

-- Test 4: Verify cascade trigger exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'cascade_configuration_soft_delete_trigger'
    ) THEN
        RAISE EXCEPTION 'cascade_configuration_soft_delete_trigger missing';
    END IF;

    RAISE NOTICE 'Test 4 PASSED: Cascade trigger exists';
END $$;

-- Test 5: Test soft delete on configurations cascades to sessions
DO $$
DECLARE
    test_tenant_id uuid := gen_random_uuid();
    test_config_id uuid := gen_random_uuid();
    test_session_id uuid := gen_random_uuid();
    test_actor uuid := gen_random_uuid();
    test_exam_id uuid := gen_random_uuid();
    test_exam_version_id uuid := gen_random_uuid();
    test_attempt_id uuid := gen_random_uuid();
    test_candidate_id uuid := gen_random_uuid();
BEGIN
    -- Create test configuration
    INSERT INTO seb.configurations (
        id, tenant_id, exam_id, exam_version_id, configuration_version,
        config_object_key, config_checksum, encryption_key_reference,
        config_key_hash, browser_exam_key_hash, lifecycle_state, created_by
    ) VALUES (
        test_config_id, test_tenant_id, test_exam_id, test_exam_version_id, 1,
        'test/config/key', repeat('a', 64), 'test-key-ref',
        repeat('b', 64), repeat('c', 64), 'active', test_actor
    );

    -- Create test session
    INSERT INTO seb.sessions (
        id, tenant_id, configuration_id, attempt_id, candidate_id,
        quit_token_hash, lifecycle_state, expires_at
    ) VALUES (
        test_session_id, test_tenant_id, test_config_id, test_attempt_id, test_candidate_id,
        repeat('d', 64), 'issued', CURRENT_TIMESTAMP + interval '2 hours'
    );

    -- Soft delete the configuration
    UPDATE seb.configurations
    SET deleted_at = CURRENT_TIMESTAMP,
        deleted_by = test_actor,
        deletion_reason = 'Test cascade'
    WHERE id = test_config_id;

    -- Verify session was also soft deleted
    IF NOT EXISTS (
        SELECT 1 FROM seb.sessions
        WHERE id = test_session_id
        AND deleted_at IS NOT NULL
        AND deletion_reason = 'Cascaded from configuration soft delete'
    ) THEN
        RAISE EXCEPTION 'Cascade soft delete failed for session';
    END IF;

    RAISE NOTICE 'Test 5 PASSED: Cascade soft delete works';

    -- Cleanup
    DELETE FROM seb.sessions WHERE id = test_session_id;
    DELETE FROM seb.configurations WHERE id = test_config_id;
END $$;

-- Test 6: Verify RLS policies filter soft-deleted records
-- Note: This requires switching to app role with proper context
-- For now, we just verify policies exist with the right names
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'seb' AND tablename = 'configurations'
        AND policyname = 'seb_configurations_signed_read'
    ) THEN
        RAISE EXCEPTION 'seb_configurations_signed_read policy missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'seb' AND tablename = 'sessions'
        AND policyname = 'seb_sessions_signed_read'
    ) THEN
        RAISE EXCEPTION 'seb_sessions_signed_read policy missing';
    END IF;

    RAISE NOTICE 'Test 6 PASSED: RLS policies exist';
END $$;

-- Test 7: Verify soft delete columns accept NULL (default state)
DO $$
DECLARE
    test_tenant_id uuid := gen_random_uuid();
    test_config_id uuid := gen_random_uuid();
    test_actor uuid := gen_random_uuid();
    test_exam_id uuid := gen_random_uuid();
    test_exam_version_id uuid := gen_random_uuid();
BEGIN
    -- Create configuration without soft delete fields
    INSERT INTO seb.configurations (
        id, tenant_id, exam_id, exam_version_id, configuration_version,
        config_object_key, config_checksum, encryption_key_reference,
        config_key_hash, lifecycle_state, created_by
    ) VALUES (
        test_config_id, test_tenant_id, test_exam_id, test_exam_version_id, 1,
        'test/config/null', repeat('e', 64), 'test-key-ref-2',
        repeat('f', 64), 'active', test_actor
    );

    -- Verify NULL values
    IF EXISTS (
        SELECT 1 FROM seb.configurations
        WHERE id = test_config_id
        AND (deleted_at IS NOT NULL OR deleted_by IS NOT NULL OR deletion_reason IS NOT NULL)
    ) THEN
        RAISE EXCEPTION 'Soft delete columns should default to NULL';
    END IF;

    RAISE NOTICE 'Test 7 PASSED: Columns accept NULL by default';

    -- Cleanup
    DELETE FROM seb.configurations WHERE id = test_config_id;
END $$;

RAISE NOTICE 'All tests PASSED';

ROLLBACK;

RESET ROLE;
