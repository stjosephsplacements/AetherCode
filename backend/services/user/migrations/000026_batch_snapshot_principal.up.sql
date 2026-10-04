SET ROLE aether_user_owner;

-- user.student_batch_affiliation.snapshot.v1 now names the student's
-- principal, because every consumer that grants access (Assessment candidate
-- assignments, Submission attempts) identifies a student by principal. The
-- commands that publish the snapshot run under a batch-affiliation or
-- accounts capability, which RLS does not let read users.students, so this
-- narrow lookup returns just the principal under either capability.
CREATE FUNCTION users.student_batch_principal(p_tenant_id uuid, p_student_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, users, authz, app
AS $function$
DECLARE
    student_principal uuid;
BEGIN
    IF NOT (authz.current_context_allows(p_tenant_id, 'user.write', 'users.student_batch_affiliations')
            OR authz.current_context_allows(p_tenant_id, 'user.write', 'users.accounts')) THEN
        RAISE EXCEPTION 'current authorization context cannot read the student principal'
            USING ERRCODE = '42501';
    END IF;
    SELECT student.principal_id INTO student_principal
    FROM users.students AS student
    WHERE student.id = p_student_id AND student.tenant_id = p_tenant_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'student was not found' USING ERRCODE = 'P0002';
    END IF;
    RETURN student_principal;
END
$function$;

REVOKE ALL ON FUNCTION users.student_batch_principal(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION users.student_batch_principal(uuid, uuid) TO aether_user_app;

RESET ROLE;
