-- Retain the revocation behavior for a controlled rollback to the preceding
-- schema: removing it could resurrect the stranded-attempt condition that the
-- forward migration fixes. A full disposable rollback removes the v1
-- workflow routine in 000005_down.sql before a fresh reapply.
SELECT 1;
