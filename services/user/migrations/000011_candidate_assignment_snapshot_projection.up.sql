-- Assessment now publishes immutable assignment snapshots rather than a
-- separate ownership event. Keep a versioned revoked tombstone locally so an
-- out-of-order active snapshot can never re-grant candidate access.
SET ROLE aether_user_owner;

ALTER TABLE users.candidate_assignment_projections
    ALTER COLUMN assignment_rule_id DROP NOT NULL,
    ADD COLUMN exam_id uuid,
    ADD COLUMN lifecycle_state text NOT NULL DEFAULT 'active'
        CHECK (lifecycle_state IN ('active', 'revoked')),
    ADD COLUMN version bigint NOT NULL DEFAULT 1 CHECK (version > 0);
CREATE INDEX candidate_assignment_projections_active_candidate_idx
    ON users.candidate_assignment_projections (candidate_id, tenant_id, candidate_assignment_id)
    WHERE lifecycle_state = 'active';

RESET ROLE;
