SET ROLE aether_user_owner;

-- Batch membership is deliberately distinct from the department-affiliation
-- bundle. A student retains every prior batch interval, while this table
-- permits only one interval to be active at a time.
CREATE TABLE users.student_batch_memberships (
    id uuid PRIMARY KEY,
    student_id uuid NOT NULL REFERENCES users.students (id) ON DELETE RESTRICT,
    tenant_id uuid NOT NULL,
    batch_id uuid NOT NULL,
    lifecycle_state text NOT NULL DEFAULT 'active'
        CHECK (lifecycle_state IN ('active', 'inactive')),
    active_from timestamptz NOT NULL DEFAULT clock_timestamp(),
    inactive_at timestamptz,
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK ((lifecycle_state = 'active') = (inactive_at IS NULL)),
    CHECK (inactive_at IS NULL OR inactive_at >= active_from)
);
CREATE UNIQUE INDEX student_batch_memberships_one_active_student_idx
    ON users.student_batch_memberships (student_id)
    WHERE lifecycle_state = 'active';
CREATE INDEX student_batch_memberships_student_history_idx
    ON users.student_batch_memberships (student_id, active_from DESC);
CREATE INDEX student_batch_memberships_tenant_batch_idx
    ON users.student_batch_memberships (tenant_id, batch_id, lifecycle_state);

-- The current row is retained even when the student is not affiliated to a
-- batch. This makes the optimistic version stable from student enrollment on
-- and prevents a missing-row race from becoming a second active affiliation.
CREATE TABLE users.current_student_batch_affiliations (
    student_id uuid PRIMARY KEY REFERENCES users.students (id) ON DELETE RESTRICT,
    tenant_id uuid NOT NULL,
    batch_id uuid,
    batch_membership_id uuid UNIQUE REFERENCES users.student_batch_memberships (id) ON DELETE RESTRICT,
    lifecycle_state text NOT NULL DEFAULT 'inactive'
        CHECK (lifecycle_state IN ('active', 'inactive')),
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (
        (lifecycle_state = 'active' AND batch_id IS NOT NULL AND batch_membership_id IS NOT NULL)
        OR (lifecycle_state = 'inactive' AND batch_id IS NULL AND batch_membership_id IS NULL)
    )
);
CREATE INDEX current_student_batch_affiliations_tenant_state_idx
    ON users.current_student_batch_affiliations (tenant_id, lifecycle_state);

CREATE FUNCTION users.protect_student_batch_membership_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, users
AS $function$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'student batch membership history cannot be deleted';
    END IF;

    IF OLD.student_id IS DISTINCT FROM NEW.student_id
       OR OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
       OR OLD.batch_id IS DISTINCT FROM NEW.batch_id
       OR OLD.active_from IS DISTINCT FROM NEW.active_from
       OR OLD.created_at IS DISTINCT FROM NEW.created_at
       OR OLD.lifecycle_state <> 'active'
       OR NEW.lifecycle_state <> 'inactive'
       OR NEW.inactive_at IS NULL
       OR NEW.inactive_at < OLD.active_from
       OR NEW.version <> OLD.version + 1 THEN
        RAISE EXCEPTION 'student batch membership history may only transition once from active to inactive';
    END IF;
    RETURN NEW;
END
$function$;

CREATE FUNCTION users.validate_current_student_batch_affiliation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, users
AS $function$
DECLARE
    student_tenant_id uuid;
    membership users.student_batch_memberships%ROWTYPE;
BEGIN
    SELECT tenant_id INTO student_tenant_id
    FROM users.students
    WHERE id = NEW.student_id;
    IF NOT FOUND OR student_tenant_id IS DISTINCT FROM NEW.tenant_id THEN
        RAISE EXCEPTION 'current student batch affiliation must belong to its student tenant';
    END IF;

    IF NEW.lifecycle_state = 'inactive' THEN
        IF NEW.batch_id IS NOT NULL OR NEW.batch_membership_id IS NOT NULL THEN
            RAISE EXCEPTION 'inactive current student batch affiliation cannot reference a batch membership';
        END IF;
        RETURN NEW;
    END IF;

    SELECT * INTO membership
    FROM users.student_batch_memberships
    WHERE id = NEW.batch_membership_id;
    IF NOT FOUND
       OR membership.student_id IS DISTINCT FROM NEW.student_id
       OR membership.tenant_id IS DISTINCT FROM NEW.tenant_id
       OR membership.batch_id IS DISTINCT FROM NEW.batch_id
       OR membership.lifecycle_state <> 'active' THEN
        RAISE EXCEPTION 'active current student batch affiliation requires its active membership for the same student, tenant, and batch';
    END IF;
    RETURN NEW;
END
$function$;

CREATE FUNCTION users.protect_current_student_batch_affiliation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, users
AS $function$
BEGIN
    RAISE EXCEPTION 'current student batch affiliation cannot be deleted';
END
$function$;

-- Insert the inactive current row with the student. Existing students are
-- backfilled below so all batch commands share the same expected-version
-- semantics from the first request onward.
CREATE FUNCTION users.create_initial_student_batch_affiliation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, users
AS $function$
BEGIN
    INSERT INTO users.current_student_batch_affiliations (
        student_id, tenant_id, lifecycle_state
    ) VALUES (
        NEW.id, NEW.tenant_id, 'inactive'
    ) ON CONFLICT (student_id) DO NOTHING;
    RETURN NEW;
END
$function$;

INSERT INTO users.current_student_batch_affiliations (
    student_id, tenant_id, lifecycle_state
)
SELECT student.id, student.tenant_id, 'inactive'
FROM users.students AS student
ON CONFLICT (student_id) DO NOTHING;

CREATE TRIGGER student_batch_memberships_protect_history
BEFORE UPDATE OR DELETE ON users.student_batch_memberships
FOR EACH ROW EXECUTE FUNCTION users.protect_student_batch_membership_history();
CREATE TRIGGER student_batch_memberships_touch_updated_at
BEFORE UPDATE ON users.student_batch_memberships
FOR EACH ROW EXECUTE FUNCTION users.touch_updated_at();
CREATE TRIGGER student_batch_memberships_reject_tenant_move
BEFORE UPDATE ON users.student_batch_memberships
FOR EACH ROW EXECUTE FUNCTION users.reject_tenant_move();
CREATE TRIGGER current_student_batch_affiliations_validate
BEFORE INSERT OR UPDATE ON users.current_student_batch_affiliations
FOR EACH ROW EXECUTE FUNCTION users.validate_current_student_batch_affiliation();
CREATE TRIGGER current_student_batch_affiliations_touch_updated_at
BEFORE UPDATE ON users.current_student_batch_affiliations
FOR EACH ROW EXECUTE FUNCTION users.touch_updated_at();
CREATE TRIGGER current_student_batch_affiliations_reject_tenant_move
BEFORE UPDATE ON users.current_student_batch_affiliations
FOR EACH ROW EXECUTE FUNCTION users.reject_tenant_move();
CREATE TRIGGER current_student_batch_affiliations_protect_delete
BEFORE DELETE ON users.current_student_batch_affiliations
FOR EACH ROW EXECUTE FUNCTION users.protect_current_student_batch_affiliation();
CREATE TRIGGER students_create_initial_batch_affiliation
AFTER INSERT ON users.students
FOR EACH ROW EXECUTE FUNCTION users.create_initial_student_batch_affiliation();

-- The only write paths are narrow SECURITY DEFINER commands. They verify the
-- request's signed central decision again at the database boundary, lock the
-- stable current row, and use its version as the compare-and-swap token.
CREATE FUNCTION users.set_student_batch_affiliation(
    p_membership_id uuid,
    p_tenant_id uuid,
    p_student_id uuid,
    p_batch_id uuid,
    p_expected_version integer
)
RETURNS TABLE (
    student_id uuid,
    tenant_id uuid,
    batch_id uuid,
    lifecycle_state text,
    version integer,
    updated_at timestamptz,
    state_changed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, users, authz, app
AS $function$
DECLARE
    student_record users.students%ROWTYPE;
    batch_record users.tenant_batch_projections%ROWTYPE;
    current_record users.current_student_batch_affiliations%ROWTYPE;
BEGIN
    IF p_membership_id IS NULL OR p_tenant_id IS NULL OR p_student_id IS NULL
       OR p_batch_id IS NULL OR p_expected_version IS NULL OR p_expected_version <= 0 THEN
        RAISE EXCEPTION 'membership, tenant, student, batch, and a positive expected version are required'
            USING ERRCODE = '23514';
    END IF;
    IF NOT users.current_context_valid_student(
        p_tenant_id, p_student_id, 'user.write', 'users.student_batch_affiliations'
    ) THEN
        RAISE EXCEPTION 'current authorization context cannot change a student batch affiliation'
            USING ERRCODE = '42501';
    END IF;

    SELECT * INTO student_record
    FROM users.students
    WHERE id = p_student_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'student was not found' USING ERRCODE = 'P0002';
    END IF;
    IF student_record.tenant_id IS DISTINCT FROM p_tenant_id THEN
        RAISE EXCEPTION 'student does not belong to the authorization tenant'
            USING ERRCODE = '42501';
    END IF;
    IF student_record.status <> 'active' THEN
        RAISE EXCEPTION 'only active students may be affiliated to a batch'
            USING ERRCODE = '23514';
    END IF;

    SELECT * INTO batch_record
    FROM users.tenant_batch_projections AS projection
    WHERE projection.batch_id = p_batch_id
    FOR SHARE;
    IF NOT FOUND
       OR batch_record.tenant_id IS DISTINCT FROM p_tenant_id
       OR batch_record.status <> 'active' THEN
        RAISE EXCEPTION 'batch projection is missing, inactive, or does not belong to the tenant'
            USING ERRCODE = '23514';
    END IF;

    SELECT * INTO current_record
    FROM users.current_student_batch_affiliations AS affiliation
    WHERE affiliation.student_id = p_student_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'student batch affiliation invariant is missing'
            USING ERRCODE = '23514';
    END IF;
    IF current_record.tenant_id IS DISTINCT FROM p_tenant_id THEN
        RAISE EXCEPTION 'current affiliation tenant is immutable'
            USING ERRCODE = '42501';
    END IF;
    IF current_record.version <> p_expected_version THEN
        RAISE EXCEPTION 'student batch affiliation version conflict'
            USING ERRCODE = '40001';
    END IF;

    -- A retried same-version request for the already-current batch is a true
    -- no-op. It does not manufacture history or emit another snapshot event.
    IF current_record.lifecycle_state = 'active'
       AND current_record.batch_id = p_batch_id THEN
        RETURN QUERY
        SELECT affiliation.student_id, affiliation.tenant_id, affiliation.batch_id,
               affiliation.lifecycle_state, affiliation.version, affiliation.updated_at, false
        FROM users.current_student_batch_affiliations AS affiliation
        WHERE affiliation.student_id = p_student_id;
        RETURN;
    END IF;

    IF current_record.lifecycle_state = 'active' THEN
        UPDATE users.student_batch_memberships AS membership
        SET lifecycle_state = 'inactive', inactive_at = clock_timestamp(),
            version = membership.version + 1
        WHERE membership.id = current_record.batch_membership_id
          AND membership.lifecycle_state = 'active';
        IF NOT FOUND THEN
            RAISE EXCEPTION 'current student batch membership is not active'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    INSERT INTO users.student_batch_memberships (
        id, student_id, tenant_id, batch_id, lifecycle_state
    ) VALUES (
        p_membership_id, p_student_id, p_tenant_id, p_batch_id, 'active'
    );

    UPDATE users.current_student_batch_affiliations AS affiliation
    SET batch_id = p_batch_id,
        batch_membership_id = p_membership_id,
        lifecycle_state = 'active',
        version = affiliation.version + 1
    WHERE affiliation.student_id = p_student_id;

    RETURN QUERY
    SELECT affiliation.student_id, affiliation.tenant_id, affiliation.batch_id,
           affiliation.lifecycle_state, affiliation.version, affiliation.updated_at, true
    FROM users.current_student_batch_affiliations AS affiliation
    WHERE affiliation.student_id = p_student_id;
END
$function$;

CREATE FUNCTION users.end_student_batch_affiliation(
    p_tenant_id uuid,
    p_student_id uuid,
    p_expected_version integer
)
RETURNS TABLE (
    student_id uuid,
    tenant_id uuid,
    batch_id uuid,
    lifecycle_state text,
    version integer,
    updated_at timestamptz,
    state_changed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, users, authz, app
AS $function$
DECLARE
    student_record users.students%ROWTYPE;
    current_record users.current_student_batch_affiliations%ROWTYPE;
BEGIN
    IF p_tenant_id IS NULL OR p_student_id IS NULL
       OR p_expected_version IS NULL OR p_expected_version <= 0 THEN
        RAISE EXCEPTION 'tenant, student, and a positive expected version are required'
            USING ERRCODE = '23514';
    END IF;
    IF NOT users.current_context_valid_student(
        p_tenant_id, p_student_id, 'user.write', 'users.student_batch_affiliations'
    ) THEN
        RAISE EXCEPTION 'current authorization context cannot revoke a student batch affiliation'
            USING ERRCODE = '42501';
    END IF;

    SELECT * INTO student_record
    FROM users.students
    WHERE id = p_student_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'student was not found' USING ERRCODE = 'P0002';
    END IF;
    IF student_record.tenant_id IS DISTINCT FROM p_tenant_id THEN
        RAISE EXCEPTION 'student does not belong to the authorization tenant'
            USING ERRCODE = '42501';
    END IF;
    IF student_record.status <> 'active' THEN
        RAISE EXCEPTION 'only active students may have a batch affiliation revoked'
            USING ERRCODE = '23514';
    END IF;

    SELECT * INTO current_record
    FROM users.current_student_batch_affiliations AS affiliation
    WHERE affiliation.student_id = p_student_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'student batch affiliation invariant is missing'
            USING ERRCODE = '23514';
    END IF;
    IF current_record.tenant_id IS DISTINCT FROM p_tenant_id THEN
        RAISE EXCEPTION 'current affiliation tenant is immutable'
            USING ERRCODE = '42501';
    END IF;
    IF current_record.version <> p_expected_version
       OR current_record.lifecycle_state <> 'active' THEN
        RAISE EXCEPTION 'student batch affiliation version conflict'
            USING ERRCODE = '40001';
    END IF;

    UPDATE users.student_batch_memberships AS membership
    SET lifecycle_state = 'inactive', inactive_at = clock_timestamp(),
        version = membership.version + 1
    WHERE membership.id = current_record.batch_membership_id
      AND membership.lifecycle_state = 'active';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'current student batch membership is not active'
            USING ERRCODE = '23514';
    END IF;

    UPDATE users.current_student_batch_affiliations AS affiliation
    SET batch_id = NULL,
        batch_membership_id = NULL,
        lifecycle_state = 'inactive',
        version = affiliation.version + 1
    WHERE affiliation.student_id = p_student_id;

    RETURN QUERY
    SELECT affiliation.student_id, affiliation.tenant_id, affiliation.batch_id,
           affiliation.lifecycle_state, affiliation.version, affiliation.updated_at, true
    FROM users.current_student_batch_affiliations AS affiliation
    WHERE affiliation.student_id = p_student_id;
END
$function$;

CREATE FUNCTION users.get_student_batch_affiliation(
    p_tenant_id uuid,
    p_student_id uuid
)
RETURNS TABLE (
    student_id uuid,
    tenant_id uuid,
    batch_id uuid,
    lifecycle_state text,
    version integer,
    updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, users, authz, app
AS $function$
BEGIN
    IF p_tenant_id IS NULL OR p_student_id IS NULL THEN
        RAISE EXCEPTION 'tenant and student are required' USING ERRCODE = '23514';
    END IF;
    IF NOT users.current_context_valid_student(
        p_tenant_id, p_student_id, 'user.read', 'users.student_batch_affiliations'
    ) THEN
        RAISE EXCEPTION 'current authorization context cannot read a student batch affiliation'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT affiliation.student_id, affiliation.tenant_id, affiliation.batch_id,
           affiliation.lifecycle_state, affiliation.version, affiliation.updated_at
    FROM users.current_student_batch_affiliations AS affiliation
    WHERE affiliation.student_id = p_student_id
      AND affiliation.tenant_id = p_tenant_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'student batch affiliation was not found' USING ERRCODE = 'P0002';
    END IF;
END
$function$;

ALTER TABLE users.student_batch_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE users.student_batch_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE users.current_student_batch_affiliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users.current_student_batch_affiliations FORCE ROW LEVEL SECURITY;

CREATE POLICY student_batch_memberships_owner_maintenance
    ON users.student_batch_memberships
    FOR ALL TO aether_user_owner
    USING (true) WITH CHECK (true);
CREATE POLICY current_student_batch_affiliations_owner_maintenance
    ON users.current_student_batch_affiliations
    FOR ALL TO aether_user_owner
    USING (true) WITH CHECK (true);

-- Placement staff may manage only students whose active placement department
-- matches their scoped grant. The central assignmentApplies check and the
-- local current_context_valid_student helper enforce that same relationship.
INSERT INTO users.authorization_policy_rules (id, ptype, v0, v1, v2, v3)
VALUES
    ('018f4b0d-08f8-7c09-9ba7-efdf9c220017', 'p', 'placement_user', 'placement_department', '/student_batch_affiliations/:id', 'read'),
    ('018f4b0d-08f8-7c09-9ba7-efdf9c220018', 'p', 'placement_user', 'placement_department', '/student_batch_affiliations/:id', 'write')
ON CONFLICT DO NOTHING;

REVOKE ALL ON TABLE users.student_batch_memberships,
    users.current_student_batch_affiliations FROM PUBLIC;
REVOKE ALL ON TABLE users.student_batch_memberships,
    users.current_student_batch_affiliations FROM aether_user_app;
REVOKE ALL ON FUNCTION users.set_student_batch_affiliation(uuid, uuid, uuid, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION users.end_student_batch_affiliation(uuid, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION users.get_student_batch_affiliation(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION users.set_student_batch_affiliation(uuid, uuid, uuid, uuid, integer)
    TO aether_user_app;
GRANT EXECUTE ON FUNCTION users.end_student_batch_affiliation(uuid, uuid, integer)
    TO aether_user_app;
GRANT EXECUTE ON FUNCTION users.get_student_batch_affiliation(uuid, uuid)
    TO aether_user_app;

RESET ROLE;
