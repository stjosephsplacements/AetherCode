-- File: services/identity/migrations/000010_rls_block_deletes.up.sql
-- Gap #3 (CRITICAL): Database layer enforcement for soft delete via RLS
-- Block DELETE operations - force all deletes through SECURITY DEFINER app.hard_delete()

SET ROLE aether_identity_owner;

-- Enable RLS on all soft-delete tables (if not already enabled)
ALTER TABLE identity.principals ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.password_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.mfa_factors ENABLE ROW LEVEL SECURITY;

-- Grant DELETE privilege to app role (required for RLS to be evaluated)
-- Without this grant, DELETE fails at privilege check before RLS evaluation
-- RLS policy will then block the DELETE - this is defense in depth
GRANT DELETE ON identity.principals TO aether_identity_app;
GRANT DELETE ON identity.password_credentials TO aether_identity_app;
GRANT DELETE ON identity.mfa_factors TO aether_identity_app;

-- For tables without existing tenant-aware RLS policies, create permissive policies for normal operations
-- These allow all rows since we're only restricting DELETE
-- (principals, password_credentials, mfa_factors don't have tenant-aware RLS yet)
CREATE POLICY allow_all_reads ON identity.principals
    FOR SELECT TO aether_identity_app USING (true);
CREATE POLICY allow_all_inserts ON identity.principals
    FOR INSERT TO aether_identity_app WITH CHECK (true);
CREATE POLICY allow_all_updates ON identity.principals
    FOR UPDATE TO aether_identity_app USING (true);

CREATE POLICY allow_all_reads ON identity.password_credentials
    FOR SELECT TO aether_identity_app USING (true);
CREATE POLICY allow_all_inserts ON identity.password_credentials
    FOR INSERT TO aether_identity_app WITH CHECK (true);
CREATE POLICY allow_all_updates ON identity.password_credentials
    FOR UPDATE TO aether_identity_app USING (true);

CREATE POLICY allow_all_reads ON identity.mfa_factors
    FOR SELECT TO aether_identity_app USING (true);
CREATE POLICY allow_all_inserts ON identity.mfa_factors
    FOR INSERT TO aether_identity_app WITH CHECK (true);
CREATE POLICY allow_all_updates ON identity.mfa_factors
    FOR UPDATE TO aether_identity_app USING (true);

-- Block all DELETE statements for application role via RLS
-- USING (false) means no row passes the policy check - all DELETEs denied
-- app.hard_delete() uses SECURITY DEFINER which bypasses RLS policies
CREATE POLICY block_delete_require_hard_delete_function ON identity.principals
    FOR DELETE TO aether_identity_app USING (false);

CREATE POLICY block_delete_require_hard_delete_function ON identity.password_credentials
    FOR DELETE TO aether_identity_app USING (false);

CREATE POLICY block_delete_require_hard_delete_function ON identity.mfa_factors
    FOR DELETE TO aether_identity_app USING (false);

COMMENT ON POLICY block_delete_require_hard_delete_function ON identity.principals IS
    'RLS enforcement: DELETE blocked for app role - must use app.hard_delete() SECURITY DEFINER function';

COMMENT ON POLICY block_delete_require_hard_delete_function ON identity.password_credentials IS
    'RLS enforcement: DELETE blocked for app role - must use app.hard_delete() SECURITY DEFINER function';

COMMENT ON POLICY block_delete_require_hard_delete_function ON identity.mfa_factors IS
    'RLS enforcement: DELETE blocked for app role - must use app.hard_delete() SECURITY DEFINER function';

RESET ROLE;
