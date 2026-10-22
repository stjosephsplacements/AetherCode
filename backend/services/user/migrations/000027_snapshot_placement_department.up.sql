SET ROLE aether_user_owner;

-- user.student_batch_affiliation.snapshot.v1 also names the student's current
-- placement department, so Assessment can deliver exams assigned to a
-- placement department (ADR-0026). Like student_batch_principal, the
-- publishing commands cannot read the memberships under RLS, so this narrow
-- lookup returns just the department under the same capabilities.
CREATE FUNCTION users.student_placement_department(p_tenant_id uuid, p_student_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, users, authz, app
AS $function$
DECLARE
    department uuid;
BEGIN
    IF NOT (authz.current_context_allows(p_tenant_id, 'user.write', 'users.student_batch_affiliations')
            OR authz.current_context_allows(p_tenant_id, 'user.write', 'users.accounts')) THEN
        RAISE EXCEPTION 'current authorization context cannot read the placement department'
            USING ERRCODE = '42501';
    END IF;
    SELECT placement.department_id INTO department
    FROM users.students AS student
    JOIN users.current_student_affiliations AS affiliation
      ON affiliation.student_id = student.id
    JOIN users.student_department_memberships AS placement
      ON placement.id = affiliation.placement_membership_id
    WHERE student.id = p_student_id AND student.tenant_id = p_tenant_id;
    RETURN department;
END
$function$;

REVOKE ALL ON FUNCTION users.student_placement_department(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION users.student_placement_department(uuid, uuid) TO aether_user_app;

RESET ROLE;
