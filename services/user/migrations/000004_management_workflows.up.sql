SET ROLE aether_user_owner;

-- Tenant is the authority for department and batch ownership. User keeps a
-- deliberately narrow event-fed projection so it can validate opaque IDs
-- without a cross-database foreign key or a synchronous tenant-table read.
CREATE TABLE users.tenant_department_projections (
    department_id uuid PRIMARY KEY,
    tenant_id uuid,
    placement_organization_id uuid,
    department_type text NOT NULL CHECK (department_type IN ('college', 'placement')),
    status text NOT NULL CHECK (status IN ('active', 'archived')),
    source_event_id uuid NOT NULL UNIQUE,
    source_occurred_at timestamptz NOT NULL,
    projected_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (
        (department_type = 'college' AND tenant_id IS NOT NULL AND placement_organization_id IS NULL)
        OR (department_type = 'placement' AND tenant_id IS NULL AND placement_organization_id IS NOT NULL)
    )
);
CREATE INDEX tenant_department_projections_tenant_idx
    ON users.tenant_department_projections (tenant_id, department_type, status)
    WHERE department_type = 'college';

CREATE TABLE users.tenant_batch_projections (
    batch_id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    department_id uuid NOT NULL,
    status text NOT NULL CHECK (status IN ('active', 'archived')),
    source_event_id uuid NOT NULL UNIQUE,
    source_occurred_at timestamptz NOT NULL,
    projected_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX tenant_batch_projections_tenant_idx
    ON users.tenant_batch_projections (tenant_id, department_id, status);

CREATE TABLE users.tenant_projection_inbox_messages (
    event_id uuid PRIMARY KEY,
    payload_sha256 bytea NOT NULL CHECK (octet_length(payload_sha256) = 32),
    occurred_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    processed_at timestamptz,
    last_error text
);
CREATE INDEX tenant_projection_inbox_pending_idx
    ON users.tenant_projection_inbox_messages (received_at) WHERE processed_at IS NULL;

-- Enrollment is one aggregate command, but the normalized model has four
-- protected relations. This SECURITY DEFINER command is intentionally narrow:
-- it requires the caller's signed users.students write context, validates the
-- tenant projection, and can create only the invariant-preserving bundle.
CREATE FUNCTION users.enroll_student_with_affiliations(
    p_student_id uuid,
    p_principal_id uuid,
    p_tenant_id uuid,
    p_enrollment_number text,
    p_college_department_id uuid,
    p_placement_department_id uuid,
    p_college_membership_id uuid,
    p_placement_membership_id uuid,
    p_granted_student_role_id uuid,
    p_created_by_principal_id uuid
)
RETURNS TABLE (
    id uuid,
    principal_id uuid,
    tenant_id uuid,
    enrollment_number text,
    status text,
    version integer,
    created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, users, authz, app
AS $function$
DECLARE
    college_department users.tenant_department_projections%ROWTYPE;
    placement_department users.tenant_department_projections%ROWTYPE;
BEGIN
    IF NOT authz.current_context_allows(p_tenant_id, 'user.write', 'users.students') THEN
        RAISE EXCEPTION 'current authorization context cannot enroll a student'
            USING ERRCODE = '42501';
    END IF;

    SELECT * INTO college_department
    FROM users.tenant_department_projections
    WHERE department_id = p_college_department_id
    FOR SHARE;
    IF NOT FOUND
       OR college_department.department_type <> 'college'
       OR college_department.status <> 'active'
       OR college_department.tenant_id IS DISTINCT FROM p_tenant_id THEN
        RAISE EXCEPTION 'college department projection is missing or does not belong to the tenant'
            USING ERRCODE = '23514';
    END IF;

    SELECT * INTO placement_department
    FROM users.tenant_department_projections
    WHERE department_id = p_placement_department_id
    FOR SHARE;
    IF NOT FOUND
       OR placement_department.department_type <> 'placement'
       OR placement_department.status <> 'active' THEN
        RAISE EXCEPTION 'placement department projection is missing or inactive'
            USING ERRCODE = '23514';
    END IF;

    INSERT INTO users.students (
        id, principal_id, tenant_id, enrollment_number, status
    ) VALUES (
        p_student_id, p_principal_id, p_tenant_id, p_enrollment_number, 'pending'
    );

    INSERT INTO users.student_department_memberships (
        id, student_id, tenant_id, department_id, department_type, status
    ) VALUES
        (p_college_membership_id, p_student_id, p_tenant_id, p_college_department_id, 'college', 'active'),
        (p_placement_membership_id, p_student_id, p_tenant_id, p_placement_department_id, 'placement', 'active');

    INSERT INTO users.current_student_affiliations (
        student_id, tenant_id, college_membership_id, placement_membership_id
    ) VALUES (
        p_student_id, p_tenant_id, p_college_membership_id, p_placement_membership_id
    );

    INSERT INTO users.role_assignments (
        id, principal_id, role_name, scope_kind, tenant_id, scope_id,
        status, granted_by_principal_id
    ) VALUES (
        p_granted_student_role_id, p_principal_id, 'student', 'self', p_tenant_id,
        p_principal_id, 'active', p_created_by_principal_id
    );

    UPDATE users.students
    SET status = 'active', version = students.version + 1
    WHERE students.id = p_student_id;

    RETURN QUERY
    SELECT student.id, student.principal_id, student.tenant_id,
           student.enrollment_number, student.status, student.version,
           student.created_at
    FROM users.students AS student
    WHERE student.id = p_student_id;
END
$function$;

REVOKE ALL ON TABLE users.tenant_department_projections, users.tenant_batch_projections,
    users.tenant_projection_inbox_messages FROM PUBLIC;
REVOKE ALL ON FUNCTION users.enroll_student_with_affiliations(
    uuid, uuid, uuid, text, uuid, uuid, uuid, uuid, uuid, uuid
) FROM PUBLIC;
GRANT SELECT ON users.tenant_department_projections, users.tenant_batch_projections
    TO aether_user_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON users.tenant_department_projections, users.tenant_batch_projections
    TO aether_user_projection_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON users.tenant_projection_inbox_messages
    TO aether_user_projection_worker;
GRANT EXECUTE ON FUNCTION users.enroll_student_with_affiliations(
    uuid, uuid, uuid, text, uuid, uuid, uuid, uuid, uuid, uuid
) TO aether_user_app;

RESET ROLE;
