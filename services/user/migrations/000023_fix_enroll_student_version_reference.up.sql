SET ROLE aether_user_owner;

-- 000004's UPDATE used an unqualified "version" reference, which is
-- ambiguous because RETURNS TABLE (..., version integer, ...) implicitly
-- declares "version" as a PL/pgSQL variable in scope for the whole function
-- body. PostgreSQL's default plpgsql.variable_conflict = error then rejects
-- every enrollment with "column reference \"version\" is ambiguous". Qualify
-- the column reference with the table's own unqualified name (valid because
-- it is not aliased in this UPDATE) to resolve it to the table column.
CREATE OR REPLACE FUNCTION users.enroll_student_with_affiliations(
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

RESET ROLE;
