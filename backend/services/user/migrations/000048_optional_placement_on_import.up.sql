SET ROLE aether_user_owner;

-- Make placement_department_id optional in the bulk student import path,
-- consistent with migration 000047 which made it optional for single enroll.
-- When NULL, no placement membership is created; students can be assigned to
-- a placement department later via the placement staff page.

-- 1. require_student_import_targets: skip the placement check when NULL.
CREATE OR REPLACE FUNCTION users.require_student_import_targets(
    p_tenant_id uuid,
    p_batch_id uuid,
    p_college_department_id uuid,
    p_placement_department_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, users
AS $function$
BEGIN
    PERFORM 1 FROM users.tenant_department_projections AS department
    WHERE department.department_id = p_college_department_id
      AND department.department_type = 'college'
      AND department.status = 'active'
      AND department.tenant_id = p_tenant_id
    FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'college department is missing, inactive, or not in this college'
            USING ERRCODE = '23514';
    END IF;

    IF p_placement_department_id IS NOT NULL THEN
        PERFORM 1 FROM users.tenant_department_projections AS department
        WHERE department.department_id = p_placement_department_id
          AND department.department_type = 'placement'
          AND department.status = 'active'
        FOR SHARE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'placement department is missing or inactive'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    PERFORM 1 FROM users.tenant_batch_projections AS batch
    WHERE batch.batch_id = p_batch_id
      AND batch.tenant_id = p_tenant_id
      AND batch.department_id = p_college_department_id
      AND batch.status = 'active'
    FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'batch is missing, archived, or not in the college department'
            USING ERRCODE = '23514';
    END IF;
END
$function$;

-- 2. import_students: skip placement membership when p_placement_department_id IS NULL.
CREATE OR REPLACE FUNCTION users.import_students(
    p_tenant_id uuid,
    p_batch_id uuid,
    p_college_department_id uuid,
    p_placement_department_id uuid,
    p_actor_id uuid,
    p_principal_ids uuid[],
    p_enrollment_numbers text[]
)
RETURNS TABLE (
    out_student_id uuid,
    out_principal_id uuid,
    out_enrollment_number text,
    out_student_version integer,
    out_affiliation_version integer,
    out_created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, users, authz, app
AS $function$
DECLARE
    row_index integer;
    new_student_id uuid;
    new_college_membership_id uuid;
    new_placement_membership_id uuid;
    new_batch_membership_id uuid;
BEGIN
    IF NOT authz.current_context_allows(p_tenant_id, 'user.write', 'users.accounts') THEN
        RAISE EXCEPTION 'current authorization context cannot import students'
            USING ERRCODE = '42501';
    END IF;
    IF p_actor_id IS NULL OR coalesce(cardinality(p_principal_ids), 0) = 0
       OR cardinality(p_principal_ids) IS DISTINCT FROM cardinality(p_enrollment_numbers) THEN
        RAISE EXCEPTION 'an actor and matching principal and enrollment arrays are required'
            USING ERRCODE = '23514';
    END IF;
    PERFORM users.require_student_import_targets(
        p_tenant_id, p_batch_id, p_college_department_id, p_placement_department_id
    );

    FOR row_index IN 1 .. cardinality(p_principal_ids) LOOP
        new_student_id := uuidv7();
        new_college_membership_id := uuidv7();
        new_batch_membership_id := uuidv7();

        INSERT INTO users.students (id, principal_id, tenant_id, enrollment_number, status)
        VALUES (new_student_id, p_principal_ids[row_index], p_tenant_id, p_enrollment_numbers[row_index], 'pending');

        INSERT INTO users.student_department_memberships (
            id, student_id, tenant_id, department_id, department_type, status
        ) VALUES
            (new_college_membership_id, new_student_id, p_tenant_id, p_college_department_id, 'college', 'active');

        IF p_placement_department_id IS NOT NULL THEN
            new_placement_membership_id := uuidv7();
            INSERT INTO users.student_department_memberships (
                id, student_id, tenant_id, department_id, department_type, status
            ) VALUES
                (new_placement_membership_id, new_student_id, p_tenant_id, p_placement_department_id, 'placement', 'active');

            INSERT INTO users.current_student_affiliations (
                student_id, tenant_id, college_membership_id, placement_membership_id
            ) VALUES (new_student_id, p_tenant_id, new_college_membership_id, new_placement_membership_id);
        ELSE
            INSERT INTO users.current_student_affiliations (
                student_id, tenant_id, college_membership_id, placement_membership_id
            ) VALUES (new_student_id, p_tenant_id, new_college_membership_id, NULL);
        END IF;

        INSERT INTO users.role_assignments (
            id, principal_id, role_name, scope_kind, tenant_id, scope_id, status, granted_by_principal_id
        ) VALUES (
            uuidv7(), p_principal_ids[row_index], 'student', 'self', p_tenant_id,
            p_principal_ids[row_index], 'active', p_actor_id
        );

        UPDATE users.students
        SET status = 'active', version = students.version + 1
        WHERE students.id = new_student_id;

        INSERT INTO users.student_batch_memberships (id, student_id, tenant_id, batch_id, lifecycle_state)
        VALUES (new_batch_membership_id, new_student_id, p_tenant_id, p_batch_id, 'active');

        UPDATE users.current_student_batch_affiliations AS affiliation
        SET batch_id = p_batch_id, batch_membership_id = new_batch_membership_id,
            lifecycle_state = 'active', version = affiliation.version + 1
        WHERE affiliation.student_id = new_student_id;
    END LOOP;

    RETURN QUERY
    SELECT student.id, student.principal_id, student.enrollment_number, student.version,
           affiliation.version, student.created_at
    FROM users.students AS student
    JOIN users.current_student_batch_affiliations AS affiliation ON affiliation.student_id = student.id
    WHERE student.tenant_id = p_tenant_id
      AND student.principal_id = ANY(p_principal_ids)
    ORDER BY array_position(p_principal_ids, student.principal_id);
END
$function$;

-- existing_enrollment_numbers delegates to require_student_import_targets
-- which now accepts NULL placement_department_id, so no change needed there.
-- Recreate with identical body to make down migration clean.
CREATE OR REPLACE FUNCTION users.existing_enrollment_numbers(
    p_tenant_id uuid,
    p_batch_id uuid,
    p_college_department_id uuid,
    p_placement_department_id uuid,
    p_enrollment_numbers text[]
)
RETURNS SETOF text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, users, authz, app
AS $function$
BEGIN
    IF NOT authz.current_context_allows(p_tenant_id, 'user.write', 'users.accounts') THEN
        RAISE EXCEPTION 'current authorization context cannot import students'
            USING ERRCODE = '42501';
    END IF;
    PERFORM users.require_student_import_targets(
        p_tenant_id, p_batch_id, p_college_department_id, p_placement_department_id
    );
    RETURN QUERY
    SELECT student.enrollment_number
    FROM users.students AS student
    WHERE student.tenant_id = p_tenant_id
      AND student.enrollment_number = ANY(p_enrollment_numbers);
END
$function$;
