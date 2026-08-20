-- Enforce soft delete: block direct DELETE via RLS.
-- Existing signed_read/insert/update policies from 000002 remain intact.
-- The RESTRICTIVE block_delete policy AND-combines with them: false AND anything = false.
-- app.hard_delete() SECURITY DEFINER bypasses RLS entirely.

SET ROLE aether_seb_owner;

-- DELETE privilege already granted in 000002; repeated here for clarity/idempotency
GRANT DELETE ON seb.configurations TO aether_seb_app;
GRANT DELETE ON seb.sessions TO aether_seb_app;

-- Replace the permissive signed_delete policies with restrictive total blocks
DROP POLICY IF EXISTS seb_configurations_signed_delete ON seb.configurations;
DROP POLICY IF EXISTS seb_sessions_signed_delete ON seb.sessions;

CREATE POLICY block_delete ON seb.configurations
    AS RESTRICTIVE
    FOR DELETE TO aether_seb_app
    USING (false);

CREATE POLICY block_delete ON seb.sessions
    AS RESTRICTIVE
    FOR DELETE TO aether_seb_app
    USING (false);

COMMENT ON POLICY block_delete ON seb.configurations IS
    'RESTRICTIVE: blocks all DELETE for app role. Use app.hard_delete() SECURITY DEFINER for physical removal.';

COMMENT ON POLICY block_delete ON seb.sessions IS
    'RESTRICTIVE: blocks all DELETE for app role. Use app.hard_delete() SECURITY DEFINER for physical removal.';

RESET ROLE;
