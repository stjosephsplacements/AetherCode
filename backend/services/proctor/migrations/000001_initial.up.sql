-- Proctor service: violation tracking and snapshot idempotency.
-- Connects to aether_proctor owned by aether_proctor_owner.
-- Roles are created by deploy/database/platform/dev-init.sh before this runs.
-- gen_random_uuid() is a pg_catalog built-in since PostgreSQL 13; no extension needed.

SET ROLE aether_proctor_owner;

DO $$
DECLARE expected_role text;
BEGIN
    FOREACH expected_role IN ARRAY ARRAY[
        'aether_proctor_owner',
        'aether_proctor_migrator',
        'aether_proctor_app'
    ] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = expected_role) THEN
            RAISE EXCEPTION 'required role % is missing; provision database roles before migrations', expected_role;
        END IF;
    END LOOP;
END;
$$;

DO $$ BEGIN EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database()); END; $$;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA proctor AUTHORIZATION aether_proctor_owner;
REVOKE ALL ON SCHEMA proctor FROM PUBLIC;
GRANT USAGE ON SCHEMA proctor TO aether_proctor_app;

-- Each detected violation for a proctored attempt.
CREATE TABLE proctor.violations (
    id          uuid        NOT NULL DEFAULT gen_random_uuid(),
    tenant_id   uuid        NOT NULL,
    attempt_id  uuid        NOT NULL,
    snapshot_id uuid        NOT NULL,
    kind        text        NOT NULL CHECK (kind IN ('phone_detected','multiple_faces','face_missing','gaze_away')),
    confidence  float8      NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    details     text        NOT NULL DEFAULT '',
    detected_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (id)
);
CREATE INDEX violation_cooldown_idx  ON proctor.violations (attempt_id, kind, detected_at DESC);
CREATE INDEX violation_attempt_idx   ON proctor.violations (tenant_id, attempt_id, detected_at DESC);

-- Idempotency guard: snapshots already run through the inference engine.
CREATE TABLE proctor.processed_snapshots (
    snapshot_id  uuid        NOT NULL,
    processed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (snapshot_id)
);
CREATE INDEX processed_snapshot_age_idx ON proctor.processed_snapshots (processed_at);

REVOKE ALL ON TABLE proctor.violations, proctor.processed_snapshots FROM PUBLIC;
GRANT SELECT, INSERT ON TABLE proctor.violations, proctor.processed_snapshots TO aether_proctor_app;

RESET ROLE;
