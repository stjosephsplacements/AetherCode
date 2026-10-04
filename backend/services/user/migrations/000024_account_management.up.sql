SET ROLE aether_user_owner;

-- Administrator account management (ADR-0019). Identity owns credentials; User
-- owns who belongs to a college. Every command below is a narrow SECURITY
-- DEFINER function that re-checks the caller's signed users.accounts write
-- context, so a college administrator can act only on accounts that belong to
-- their own college and to no other.

-- tenant_only_principals keeps principals that are students or staff of the
-- tenant and hold nothing anywhere else (no platform, placement or other
-- college role). It performs no authorization check and is not granted.
CREATE FUNCTION users.tenant_only_principals(p_tenant_id uuid, p_principal_ids uuid[])
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, users
AS $function$
    SELECT candidate.principal_id
    FROM unnest(p_principal_ids) AS candidate(principal_id)
    WHERE (
            EXISTS (
                SELECT 1 FROM users.students AS student
                WHERE student.principal_id = candidate.principal_id
                  AND student.tenant_id = p_tenant_id
                  AND student.deleted_at IS NULL
            )
            OR EXISTS (
                SELECT 1 FROM users.role_assignments AS assignment
                WHERE assignment.principal_id = candidate.principal_id
                  AND assignment.tenant_id = p_tenant_id
                  AND assignment.status = 'active'
                  AND assignment.deleted_at IS NULL
            )
          )
      AND NOT EXISTS (
            SELECT 1 FROM users.role_assignments AS assignment
            WHERE assignment.principal_id = candidate.principal_id
              AND assignment.status = 'active'
              AND assignment.tenant_id IS DISTINCT FROM p_tenant_id
          )
      AND NOT EXISTS (
            SELECT 1 FROM users.students AS student
            WHERE student.principal_id = candidate.principal_id
              AND student.tenant_id <> p_tenant_id
          )
$function$;

-- require_student_import_targets checks that the departments and batch exist,
-- are active, and belong to the tenant, and that the batch is in the college
-- department. It locks them against a concurrent archive. Not granted.
CREATE FUNCTION users.require_student_import_targets(
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
    PERFORM 1 FROM users.tenant_department_projections AS department
    WHERE department.department_id = p_placement_department_id
      AND department.department_type = 'placement'
      AND department.status = 'active'
    FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'placement department is missing or inactive'
            USING ERRCODE = '23514';
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

-- existing_enrollment_numbers validates an import's targets and returns the
-- roll numbers the college already has, which the import skips.
CREATE FUNCTION users.existing_enrollment_numbers(
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

-- import_students enrolls each provisioned principal as an active student of
-- the college and places it in the batch: the same bundle that
-- enroll_student_with_affiliations and set_student_batch_affiliation create,
-- for a whole file at once and under one users.accounts capability.
CREATE FUNCTION users.import_students(
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
        new_placement_membership_id := uuidv7();
        new_batch_membership_id := uuidv7();

        INSERT INTO users.students (id, principal_id, tenant_id, enrollment_number, status)
        VALUES (new_student_id, p_principal_ids[row_index], p_tenant_id, p_enrollment_numbers[row_index], 'pending');

        INSERT INTO users.student_department_memberships (
            id, student_id, tenant_id, department_id, department_type, status
        ) VALUES
            (new_college_membership_id, new_student_id, p_tenant_id, p_college_department_id, 'college', 'active'),
            (new_placement_membership_id, new_student_id, p_tenant_id, p_placement_department_id, 'placement', 'active');

        INSERT INTO users.current_student_affiliations (
            student_id, tenant_id, college_membership_id, placement_membership_id
        ) VALUES (new_student_id, p_tenant_id, new_college_membership_id, new_placement_membership_id);

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

-- tenant_account_principals returns the subset of principals this college
-- may manage (see tenant_only_principals).
CREATE FUNCTION users.tenant_account_principals(p_tenant_id uuid, p_principal_ids uuid[])
RETURNS SETOF uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, users, authz, app
AS $function$
BEGIN
    IF NOT authz.current_context_allows(p_tenant_id, 'user.write', 'users.accounts') THEN
        RAISE EXCEPTION 'current authorization context cannot manage accounts'
            USING ERRCODE = '42501';
    END IF;
    RETURN QUERY SELECT users.tenant_only_principals(p_tenant_id, p_principal_ids);
END
$function$;

-- batch_account_principals lists the manageable students currently in a
-- batch, for reissuing the whole batch's passwords.
CREATE FUNCTION users.batch_account_principals(p_tenant_id uuid, p_batch_id uuid)
RETURNS TABLE (out_principal_id uuid, out_enrollment_number text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, users, authz, app
AS $function$
DECLARE
    batch_principals uuid[];
BEGIN
    IF NOT authz.current_context_allows(p_tenant_id, 'user.write', 'users.accounts') THEN
        RAISE EXCEPTION 'current authorization context cannot manage accounts'
            USING ERRCODE = '42501';
    END IF;
    SELECT array_agg(student.principal_id) INTO batch_principals
    FROM users.students AS student
    JOIN users.current_student_batch_affiliations AS affiliation ON affiliation.student_id = student.id
    WHERE student.tenant_id = p_tenant_id
      AND student.deleted_at IS NULL
      AND affiliation.lifecycle_state = 'active'
      AND affiliation.batch_id = p_batch_id;
    RETURN QUERY
    SELECT student.principal_id, student.enrollment_number
    FROM users.students AS student
    WHERE student.principal_id IN (SELECT users.tenant_only_principals(p_tenant_id, batch_principals))
    ORDER BY student.enrollment_number;
END
$function$;

-- grant_staff_role makes a freshly provisioned principal a college
-- administrator or a department's faculty member.
CREATE FUNCTION users.grant_staff_role(
    p_tenant_id uuid,
    p_principal_id uuid,
    p_role_name text,
    p_department_id uuid,
    p_actor_id uuid
)
RETURNS TABLE (
    out_id uuid,
    out_scope_kind text,
    out_scope_id uuid,
    out_status text,
    out_version integer,
    out_created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, users, authz, app
AS $function$
DECLARE
    role_scope_kind text;
    role_scope_id uuid;
BEGIN
    IF NOT authz.current_context_allows(p_tenant_id, 'user.write', 'users.accounts') THEN
        RAISE EXCEPTION 'current authorization context cannot create staff'
            USING ERRCODE = '42501';
    END IF;
    IF p_role_name = 'college_admin' AND p_department_id IS NULL THEN
        role_scope_kind := 'college';
        role_scope_id := p_tenant_id;
    ELSIF p_role_name = 'department_user' AND p_department_id IS NOT NULL THEN
        PERFORM 1 FROM users.tenant_department_projections AS department
        WHERE department.department_id = p_department_id
          AND department.department_type = 'college'
          AND department.status = 'active'
          AND department.tenant_id = p_tenant_id
        FOR SHARE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'department is missing, inactive, or not in this college'
                USING ERRCODE = '23514';
        END IF;
        role_scope_kind := 'department';
        role_scope_id := p_department_id;
    ELSE
        RAISE EXCEPTION 'staff role must be college_admin, or department_user with a department'
            USING ERRCODE = '23514';
    END IF;
    RETURN QUERY
    WITH inserted AS (
        INSERT INTO users.role_assignments AS assignment (
            id, principal_id, role_name, scope_kind, tenant_id, scope_id, status, granted_by_principal_id
        ) VALUES (
            uuidv7(), p_principal_id, p_role_name, role_scope_kind, p_tenant_id, role_scope_id, 'active', p_actor_id
        )
        RETURNING assignment.id, assignment.scope_kind, assignment.scope_id, assignment.status,
                  assignment.version, assignment.created_at
    )
    SELECT * FROM inserted;
END
$function$;

REVOKE ALL ON FUNCTION users.tenant_only_principals(uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION users.require_student_import_targets(uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION users.existing_enrollment_numbers(uuid, uuid, uuid, uuid, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION users.import_students(uuid, uuid, uuid, uuid, uuid, uuid[], text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION users.tenant_account_principals(uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION users.batch_account_principals(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION users.grant_staff_role(uuid, uuid, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION users.existing_enrollment_numbers(uuid, uuid, uuid, uuid, text[]) TO aether_user_app;
GRANT EXECUTE ON FUNCTION users.import_students(uuid, uuid, uuid, uuid, uuid, uuid[], text[]) TO aether_user_app;
GRANT EXECUTE ON FUNCTION users.tenant_account_principals(uuid, uuid[]) TO aether_user_app;
GRANT EXECUTE ON FUNCTION users.batch_account_principals(uuid, uuid) TO aether_user_app;
GRANT EXECUTE ON FUNCTION users.grant_staff_role(uuid, uuid, text, uuid, uuid) TO aether_user_app;

RESET ROLE;
