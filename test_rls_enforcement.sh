#!/usr/bin/env bash
set -euo pipefail

# Test RLS enforcement: direct DELETEs should fail, app.hard_delete() should succeed

echo "=== Testing RLS DELETE enforcement ==="
echo

# Test Identity service
echo "1. Testing Identity service (principals table)"
echo "   a) Direct DELETE as app role should FAIL..."
PGPASSWORD=change-me psql -U aether_identity_app -h localhost -d aether_identity -c \
  "DELETE FROM identity.principals WHERE id = gen_random_uuid()" 2>&1 | grep -q "permission denied\|new row violates row-level security policy" && \
  echo "   ✓ Direct DELETE correctly blocked by RLS" || \
  echo "   ✗ FAIL: Direct DELETE was allowed (security gap!)"

echo "   b) hard_delete() function should SUCCEED..."
PGPASSWORD=change-me psql -U aether_identity_app -h localhost -d aether_identity -c \
  "SELECT app.hard_delete('identity.principals', gen_random_uuid(), gen_random_uuid(), 'Test delete')" >/dev/null 2>&1 && \
  echo "   ✓ hard_delete() function works (SECURITY DEFINER bypasses RLS)" || \
  echo "   ✗ hard_delete() failed (unexpected)"

echo

# Test Tenant service
echo "2. Testing Tenant service (tenants table)"
echo "   a) Direct DELETE as app role should FAIL..."
PGPASSWORD=change-me psql -U aether_tenant_app -h localhost -d aether_tenant -c \
  "DELETE FROM tenant.tenants WHERE id = gen_random_uuid()" 2>&1 | grep -q "permission denied\|new row violates row-level security policy" && \
  echo "   ✓ Direct DELETE correctly blocked by RLS" || \
  echo "   ✗ FAIL: Direct DELETE was allowed (security gap!)"

echo "   b) hard_delete() function should SUCCEED..."
PGPASSWORD=change-me psql -U aether_tenant_app -h localhost -d aether_tenant -c \
  "SELECT app.hard_delete('tenant.tenants', gen_random_uuid(), gen_random_uuid(), 'Test delete')" >/dev/null 2>&1 && \
  echo "   ✓ hard_delete() function works (SECURITY DEFINER bypasses RLS)" || \
  echo "   ✗ hard_delete() failed (unexpected)"

echo

# Test User service
echo "3. Testing User service (profiles table)"
echo "   a) Direct DELETE as app role should FAIL..."
PGPASSWORD=change-me psql -U aether_user_app -h localhost -d aether_users -c \
  "DELETE FROM users.profiles WHERE id = gen_random_uuid()" 2>&1 | grep -q "permission denied\|new row violates row-level security policy" && \
  echo "   ✓ Direct DELETE correctly blocked by RLS" || \
  echo "   ✗ FAIL: Direct DELETE was allowed (security gap!)"

echo "   b) hard_delete() function should SUCCEED..."
PGPASSWORD=change-me psql -U aether_user_app -h localhost -d aether_users -c \
  "SELECT app.hard_delete('users.profiles', gen_random_uuid(), gen_random_uuid(), 'Test delete')" >/dev/null 2>&1 && \
  echo "   ✓ hard_delete() function works (SECURITY DEFINER bypasses RLS)" || \
  echo "   ✗ hard_delete() failed (unexpected)"

echo

# Test Assessment service
echo "4. Testing Assessment service (exams table)"
echo "   a) Direct DELETE as app role should FAIL..."
PGPASSWORD=change-me psql -U aether_assessment_app -h localhost -d aether_assessment -c \
  "DELETE FROM assessment.exams WHERE id = gen_random_uuid()" 2>&1 | grep -q "permission denied\|new row violates row-level security policy" && \
  echo "   ✓ Direct DELETE correctly blocked by RLS" || \
  echo "   ✗ FAIL: Direct DELETE was allowed (security gap!)"

echo "   b) hard_delete() function should SUCCEED..."
PGPASSWORD=change-me psql -U aether_assessment_app -h localhost -d aether_assessment -c \
  "SELECT app.hard_delete('assessment.exams', gen_random_uuid(), gen_random_uuid(), 'Test delete')" >/dev/null 2>&1 && \
  echo "   ✓ hard_delete() function works (SECURITY DEFINER bypasses RLS)" || \
  echo "   ✗ hard_delete() failed (unexpected)"

echo

# Test Submission service
echo "5. Testing Submission service (attempts table)"
echo "   a) Direct DELETE as app role should FAIL..."
PGPASSWORD=change-me psql -U aether_submission_app -h localhost -d aether_submission -c \
  "DELETE FROM submission.attempts WHERE id = gen_random_uuid()" 2>&1 | grep -q "permission denied\|new row violates row-level security policy" && \
  echo "   ✓ Direct DELETE correctly blocked by RLS" || \
  echo "   ✗ FAIL: Direct DELETE was allowed (security gap!)"

echo "   b) hard_delete() function should SUCCEED..."
PGPASSWORD=change-me psql -U aether_submission_app -h localhost -d aether_submission -c \
  "SELECT app.hard_delete('submission.attempts', gen_random_uuid(), gen_random_uuid(), 'Test delete')" >/dev/null 2>&1 && \
  echo "   ✓ hard_delete() function works (SECURITY DEFINER bypasses RLS)" || \
  echo "   ✗ hard_delete() failed (unexpected)"

echo

# Test Question-bank service
echo "6. Testing Question-bank service (questions table)"
echo "   a) Direct DELETE as app role should FAIL..."
PGPASSWORD=change-me psql -U aether_question_bank_app -h localhost -d aether_qbank -c \
  "DELETE FROM qbank.questions WHERE id = gen_random_uuid()" 2>&1 | grep -q "permission denied\|new row violates row-level security policy" && \
  echo "   ✓ Direct DELETE correctly blocked by RLS" || \
  echo "   ✗ FAIL: Direct DELETE was allowed (security gap!)"

echo "   b) hard_delete() function should SUCCEED..."
PGPASSWORD=change-me psql -U aether_question_bank_app -h localhost -d aether_qbank -c \
  "SELECT app.hard_delete('qbank.questions', gen_random_uuid(), gen_random_uuid(), 'Test delete')" >/dev/null 2>&1 && \
  echo "   ✓ hard_delete() function works (SECURITY DEFINER bypasses RLS)" || \
  echo "   ✗ hard_delete() failed (unexpected)"

echo
echo "=== RLS enforcement test complete ==="
