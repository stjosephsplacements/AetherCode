-- Candidate-assignment ownership is an event-fed, opaque-ID projection used
-- only by the canonical authorization reader. It lets a student read its own
-- Assessment assignment without granting a self role access to arbitrary
-- assignment UUIDs. Projection lag denies the request.
SET ROLE aether_user_owner;

CREATE TABLE users.candidate_assignment_projections (
    candidate_assignment_id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    assignment_rule_id uuid NOT NULL,
    exam_version_id uuid NOT NULL,
    source_event_id uuid NOT NULL UNIQUE,
    source_occurred_at timestamptz NOT NULL,
    projected_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX candidate_assignment_projections_candidate_idx
    ON users.candidate_assignment_projections (candidate_id, tenant_id, candidate_assignment_id);

CREATE TABLE users.assessment_projection_inbox_messages (
    event_id uuid PRIMARY KEY,
    payload_sha256 bytea NOT NULL CHECK (octet_length(payload_sha256) = 32),
    occurred_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    processed_at timestamptz,
    last_error text
);
CREATE INDEX assessment_projection_inbox_pending_idx
    ON users.assessment_projection_inbox_messages (received_at)
    WHERE processed_at IS NULL;

REVOKE ALL ON TABLE users.candidate_assignment_projections,
    users.assessment_projection_inbox_messages FROM PUBLIC;
GRANT SELECT ON users.candidate_assignment_projections TO aether_user_authz_reader;
GRANT SELECT, INSERT, UPDATE, DELETE ON users.candidate_assignment_projections,
    users.assessment_projection_inbox_messages TO aether_user_projection_worker;

RESET ROLE;
