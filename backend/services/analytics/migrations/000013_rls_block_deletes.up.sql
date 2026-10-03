-- Enforce soft delete: block direct DELETE via RLS.
-- Existing signed_read/insert/update policies from 000002 remain intact.
-- The RESTRICTIVE block_delete policy AND-combines with them: false AND anything = false.
-- app.hard_delete() SECURITY DEFINER bypasses RLS entirely.

SET ROLE aether_analytics_owner;

-- DELETE privilege already granted in 000002; repeated here for clarity/idempotency
GRANT DELETE ON analytics.report_exports TO aether_analytics_app;

-- Replace the permissive signed_delete with a restrictive total block
DROP POLICY IF EXISTS analytics_report_exports_signed_delete ON analytics.report_exports;

CREATE POLICY block_delete ON analytics.report_exports
    AS RESTRICTIVE
    FOR DELETE TO aether_analytics_app
    USING (false);

COMMENT ON POLICY block_delete ON analytics.report_exports IS
    'RESTRICTIVE: blocks all DELETE for app role. Use app.hard_delete() SECURITY DEFINER for physical removal.';

RESET ROLE;
