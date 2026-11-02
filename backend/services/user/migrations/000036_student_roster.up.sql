-- The staff console's student table (ADR-0057): students with their batch, college and
-- placement department, profile name and batch mentors, filtered, searched and sorted in
-- one read. The app role has no direct access to the batch affiliation table, and profiles
-- and mentor assignments are scoped to their own resources, so this is a SECURITY DEFINER
-- function. It keeps the students table's own rule: a student is listed only when the
-- caller's authorization context may read that student, so placement officers, mentors and
-- department staff see just their own scope.
SET ROLE aether_user_owner;

CREATE FUNCTION users.student_roster(
    p_tenant_id uuid,
    p_status text,
    p_batch_id uuid,
    p_department_id uuid,
    p_placement_department_id uuid,
    p_query_pattern text,
    p_sort text,
    p_descending boolean,
    p_cursor_sort text,
    p_cursor_id uuid,
    p_limit integer
)
RETURNS TABLE (
    id uuid,
    principal_id uuid,
    tenant_id uuid,
    enrollment_number text,
    status text,
    version integer,
    created_at timestamptz,
    batch_id uuid,
    profile_name text,
    college_department_id uuid,
    placement_department_id uuid,
    mentor_principal_ids uuid[],
    total bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, users, authz, app
AS $function$
DECLARE
    v_column text;
    v_operator text;
    v_direction text;
BEGIN
    IF p_tenant_id IS NULL OR p_limit IS NULL OR p_limit < 1 OR p_limit > 201 THEN
        RAISE EXCEPTION 'tenant and a limit of 1 to 201 are required' USING ERRCODE = '23514';
    END IF;
    IF p_sort NOT IN ('enrollment_number', 'name') THEN
        RAISE EXCEPTION 'sort must be enrollment_number or name' USING ERRCODE = '23514';
    END IF;
    v_column := CASE p_sort WHEN 'name' THEN 'sort_name' ELSE 'enrollment_number' END;
    v_operator := CASE WHEN p_descending THEN '<' ELSE '>' END;
    v_direction := CASE WHEN p_descending THEN 'DESC' ELSE 'ASC' END;

    RETURN QUERY EXECUTE format($query$
        WITH base AS (
            SELECT student.id, student.principal_id, student.tenant_id, student.enrollment_number, student.status,
                   student.version, student.created_at, affiliation.batch_id,
                   COALESCE(NULLIF(btrim(profile.preferred_name), ''), btrim(concat_ws(' ', profile.given_name, profile.family_name))) AS profile_name,
                   lower(COALESCE(NULLIF(btrim(profile.preferred_name), ''), btrim(concat_ws(' ', profile.given_name, profile.family_name)), '')) AS sort_name
            FROM users.students AS student
            LEFT JOIN users.current_student_batch_affiliations AS affiliation
                   ON affiliation.student_id = student.id AND affiliation.lifecycle_state = 'active'
            LEFT JOIN users.profiles AS profile ON profile.principal_id = student.principal_id
            WHERE student.tenant_id = $1
              AND student.deleted_at IS NULL
              AND (users.current_context_valid_student(student.tenant_id, student.id, 'user.read', 'users.students')
                   OR users.current_context_valid_student(student.tenant_id, student.id, 'user.write', 'users.students'))
              AND ($2::text IS NULL OR student.status = $2)
              AND ($3::uuid IS NULL OR affiliation.batch_id = $3)
              AND ($4::uuid IS NULL OR EXISTS (
                    SELECT 1 FROM users.student_department_memberships AS membership
                    WHERE membership.student_id = student.id AND membership.department_id = $4
                      AND membership.status = 'active' AND membership.deleted_at IS NULL))
              AND ($5::uuid IS NULL OR EXISTS (
                    SELECT 1 FROM users.student_department_memberships AS membership
                    WHERE membership.student_id = student.id AND membership.department_id = $5
                      AND membership.status = 'active' AND membership.deleted_at IS NULL))
        ), matching AS (
            SELECT * FROM base
            WHERE $6::text IS NULL OR base.enrollment_number ILIKE $6 OR base.sort_name LIKE lower($6)
        )
        SELECT matching.id, matching.principal_id, matching.tenant_id, matching.enrollment_number, matching.status,
               matching.version, matching.created_at, matching.batch_id, matching.profile_name,
               (SELECT membership.department_id FROM users.student_department_memberships AS membership
                 WHERE membership.student_id = matching.id AND membership.department_type = 'college'
                   AND membership.status = 'active' AND membership.deleted_at IS NULL LIMIT 1),
               (SELECT membership.department_id FROM users.student_department_memberships AS membership
                 WHERE membership.student_id = matching.id AND membership.department_type = 'placement'
                   AND membership.status = 'active' AND membership.deleted_at IS NULL LIMIT 1),
               COALESCE((SELECT array_agg(assignment.mentor_principal_id ORDER BY assignment.created_at)
                 FROM users.mentor_batch_assignments AS assignment
                 WHERE assignment.tenant_id = matching.tenant_id AND assignment.batch_id = matching.batch_id
                   AND assignment.status = 'active'), '{}'::uuid[]),
               (SELECT count(*) FROM matching)
        FROM matching
        WHERE $7::text IS NULL OR (matching.%1$s, matching.id) %2$s ($7, $8::uuid)
        ORDER BY matching.%1$s %3$s, matching.id %3$s
        LIMIT $9
    $query$, v_column, v_operator, v_direction)
    USING p_tenant_id, p_status, p_batch_id, p_department_id, p_placement_department_id,
          p_query_pattern, p_cursor_sort, p_cursor_id, p_limit;
END
$function$;

REVOKE ALL ON FUNCTION users.student_roster(uuid, text, uuid, uuid, uuid, text, text, boolean, text, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION users.student_roster(uuid, text, uuid, uuid, uuid, text, text, boolean, text, uuid, integer)
    TO aether_user_app;

RESET ROLE;
