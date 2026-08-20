-- Keyset pagination over the tenant student roster orders by (created_at, id).
-- Without the trailing id the index cannot satisfy the tiebreak comparison and
-- a large tenant falls back to a sort.
SET ROLE aether_user_owner;

CREATE INDEX students_tenant_keyset_idx
    ON users.students (tenant_id, created_at DESC, id DESC);

RESET ROLE;
