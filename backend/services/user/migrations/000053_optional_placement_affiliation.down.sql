SET ROLE aether_user_owner;

-- Refuse to roll back while students without a placement exist: the old schema cannot hold them.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM users.current_student_affiliations WHERE placement_membership_id IS NULL) THEN
        RAISE EXCEPTION 'cannot roll back 000053: students without a placement affiliation exist' USING ERRCODE = '55000';
    END IF;
END
$$;

ALTER TABLE users.current_student_affiliations ALTER COLUMN placement_membership_id SET NOT NULL;

CREATE OR REPLACE FUNCTION users.validate_current_student_affiliation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, users AS $function$
DECLARE college_membership users.student_department_memberships%ROWTYPE;
DECLARE placement_membership users.student_department_memberships%ROWTYPE;
BEGIN
    SELECT * INTO college_membership FROM users.student_department_memberships
    WHERE id = NEW.college_membership_id;
    SELECT * INTO placement_membership FROM users.student_department_memberships
    WHERE id = NEW.placement_membership_id;

    IF NOT FOUND
       OR college_membership.student_id IS DISTINCT FROM NEW.student_id
       OR college_membership.tenant_id IS DISTINCT FROM NEW.tenant_id
       OR college_membership.department_type <> 'college'
       OR college_membership.status <> 'active'
       OR placement_membership.student_id IS DISTINCT FROM NEW.student_id
       OR placement_membership.tenant_id IS DISTINCT FROM NEW.tenant_id
       OR placement_membership.department_type <> 'placement'
       OR placement_membership.status <> 'active'
    THEN
        RAISE EXCEPTION 'current student affiliation requires one active college and one active placement membership for the same student and tenant';
    END IF;
    RETURN NEW;
END
$function$;

RESET ROLE;
