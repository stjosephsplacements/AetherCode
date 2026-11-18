-- A student imported without a placement department (migration 000048) has a college membership and no
-- placement membership. The original schema made placement_membership_id NOT NULL and the validating trigger
-- demanded an active placement membership, so every such import rolled back. A NULL placement is now allowed;
-- when one is given it is still validated, and the college membership always is.
SET ROLE aether_user_owner;

ALTER TABLE users.current_student_affiliations ALTER COLUMN placement_membership_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION users.validate_current_student_affiliation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, users AS $function$
DECLARE college_membership users.student_department_memberships%ROWTYPE;
DECLARE placement_membership users.student_department_memberships%ROWTYPE;
BEGIN
    SELECT * INTO college_membership FROM users.student_department_memberships
    WHERE id = NEW.college_membership_id;
    IF NOT FOUND
       OR college_membership.student_id IS DISTINCT FROM NEW.student_id
       OR college_membership.tenant_id IS DISTINCT FROM NEW.tenant_id
       OR college_membership.department_type <> 'college'
       OR college_membership.status <> 'active'
    THEN
        RAISE EXCEPTION 'current student affiliation requires one active college membership for the same student and tenant';
    END IF;

    IF NEW.placement_membership_id IS NOT NULL THEN
        SELECT * INTO placement_membership FROM users.student_department_memberships
        WHERE id = NEW.placement_membership_id;
        IF NOT FOUND
           OR placement_membership.student_id IS DISTINCT FROM NEW.student_id
           OR placement_membership.tenant_id IS DISTINCT FROM NEW.tenant_id
           OR placement_membership.department_type <> 'placement'
           OR placement_membership.status <> 'active'
        THEN
            RAISE EXCEPTION 'a current student placement affiliation requires an active placement membership for the same student and tenant';
        END IF;
    END IF;
    RETURN NEW;
END
$function$;

RESET ROLE;
