-- File: services/identity/migrations/000010_rls_block_deletes.down.sql
-- Rollback RLS DELETE blocking policies

SET ROLE aether_identity_owner;

-- Drop RLS policies for principals
DROP POLICY IF EXISTS allow_all_reads ON identity.principals;
DROP POLICY IF EXISTS allow_all_inserts ON identity.principals;
DROP POLICY IF EXISTS allow_all_updates ON identity.principals;
DROP POLICY IF EXISTS block_delete_require_hard_delete_function ON identity.principals;

-- Drop RLS policies for password_credentials
DROP POLICY IF EXISTS allow_all_reads ON identity.password_credentials;
DROP POLICY IF EXISTS allow_all_inserts ON identity.password_credentials;
DROP POLICY IF EXISTS allow_all_updates ON identity.password_credentials;
DROP POLICY IF EXISTS block_delete_require_hard_delete_function ON identity.password_credentials;

-- Drop RLS policies for mfa_factors
DROP POLICY IF EXISTS allow_all_reads ON identity.mfa_factors;
DROP POLICY IF EXISTS allow_all_inserts ON identity.mfa_factors;
DROP POLICY IF EXISTS allow_all_updates ON identity.mfa_factors;
DROP POLICY IF EXISTS block_delete_require_hard_delete_function ON identity.mfa_factors;

-- Revoke DELETE privileges (restore original privilege set)
REVOKE DELETE ON identity.principals FROM aether_identity_app;
REVOKE DELETE ON identity.password_credentials FROM aether_identity_app;
REVOKE DELETE ON identity.mfa_factors FROM aether_identity_app;

-- Disable RLS
ALTER TABLE identity.principals DISABLE ROW LEVEL SECURITY;
ALTER TABLE identity.password_credentials DISABLE ROW LEVEL SECURITY;
ALTER TABLE identity.mfa_factors DISABLE ROW LEVEL SECURITY;

RESET ROLE;
