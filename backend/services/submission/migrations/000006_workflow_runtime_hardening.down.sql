-- Keep the deterministic PL/pgSQL policy and additive event fields if a
-- controlled rollback targets the preceding schema.  Reinstating the prior
-- ambiguous function configuration would make that schema unsafe to serve.
-- Full disposable rollback subsequently removes the v1 workflow routines in
-- 000005_down.sql, and re-application is deterministic.
SELECT 1;
