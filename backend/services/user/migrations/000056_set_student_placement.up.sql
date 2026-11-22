-- Placement officers map existing college students into a track (ADR-0089).
-- Expands placement visibility to the unplaced pool, grants write on
-- student_department_memberships to placement officers, and adds
-- users.set_student_placement_department for assign/clear.

SET ROLE aether_user_owner;

-- Placement staff may see students already in their track, and students with
-- no active placement (the pool). Students on another track stay hidden.
CREATE OR REPLACE FUNCTION users.current_context_valid_student(
    p_tenant_id uuid,
    p_student_id uuid,
    p_required_action text,
    p_required_resource text
)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, users, authz, app
AS $function$
    SELECT p_tenant_id IS NOT NULL
       AND p_student_id IS NOT NULL
       AND p_required_action IS NOT NULL
       AND p_required_resource IS NOT NULL
       AND EXISTS (
            SELECT 1
            FROM authz.request_contexts AS context
            JOIN authz.actor_tenant_authorizations AS grant_row
              ON grant_row.actor_id = context.actor_id
             AND grant_row.tenant_id = p_tenant_id
             AND grant_row.authz_revision = context.authz_revision
             AND grant_row.is_authorized
             AND (grant_row.expires_at IS NULL OR grant_row.expires_at > clock_timestamp())
            WHERE context.context_id = app.current_context_id()
              AND context.backend_pid = pg_backend_pid()
              AND context.transaction_id = txid_current()
              AND context.expires_at > clock_timestamp()
              AND context.tenant_id = p_tenant_id
              AND context.action = p_required_action
              AND context.resource = p_required_resource
              AND (
                    grant_row.grant_kind IN ('platform', 'tenant')
                    OR (
                        grant_row.grant_kind = 'placement'
                        AND (
                            EXISTS (
                                SELECT 1
                                FROM users.student_department_memberships AS membership
                                WHERE membership.student_id = p_student_id
                                  AND membership.tenant_id = p_tenant_id
                                  AND membership.department_type = 'placement'
                                  AND membership.department_id = grant_row.grant_source_id
                                  AND membership.status = 'active'
                            )
                            OR NOT EXISTS (
                                SELECT 1
                                FROM users.student_department_memberships AS membership
                                WHERE membership.student_id = p_student_id
                                  AND membership.department_type = 'placement'
                                  AND membership.status = 'active'
                            )
                        )
                    )
              )
       )
$function$;

-- Assign or clear a student's placement department. Callers must hold
-- placement write on the target department (or tenant write on memberships).
-- Rejects moving a student who already sits on a different active track.
CREATE OR REPLACE FUNCTION users.set_student_placement_department(
    p_tenant_id uuid,
    p_student_id uuid,
    p_placement_department_id uuid,
    p_membership_id uuid
)
RETURNS TABLE (
    student_id uuid,
    tenant_id uuid,
    placement_department_id uuid,
    placement_membership_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, users, authz, app
AS $function$
DECLARE
    current_membership users.student_department_memberships%ROWTYPE;
    placement_department users.tenant_department_projections%ROWTYPE;
    new_membership_id uuid;
    has_current boolean := false;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM users.students AS student
        WHERE student.id = p_student_id
          AND student.tenant_id = p_tenant_id
          AND student.deleted_at IS NULL
          AND student.status = 'active'
        FOR SHARE
    ) THEN
        RAISE EXCEPTION 'student was not found'
            USING ERRCODE = 'P0002';
    END IF;

    SELECT * INTO current_membership
    FROM users.student_department_memberships
    WHERE student_id = p_student_id
      AND department_type = 'placement'
      AND status = 'active'
    FOR UPDATE;
    has_current := FOUND;

    IF p_placement_department_id IS NULL THEN
        IF NOT has_current THEN
            RETURN QUERY SELECT p_student_id, p_tenant_id, NULL::uuid, NULL::uuid;
            RETURN;
        END IF;
        IF NOT (
            authz.current_context_allows_placement(current_membership.department_id, 'user.write', 'users.student_department_memberships')
            OR authz.current_context_allows(p_tenant_id, 'user.write', 'users.student_department_memberships')
        ) THEN
            RAISE EXCEPTION 'current authorization context cannot clear this placement membership'
                USING ERRCODE = '42501';
        END IF;

        UPDATE users.current_student_affiliations
        SET placement_membership_id = NULL
        WHERE student_id = p_student_id AND tenant_id = p_tenant_id;

        UPDATE users.student_department_memberships
        SET status = 'revoked', version = version + 1, updated_at = clock_timestamp()
        WHERE id = current_membership.id;

        RETURN QUERY SELECT p_student_id, p_tenant_id, NULL::uuid, NULL::uuid;
        RETURN;
    END IF;

    IF NOT (
        authz.current_context_allows_placement(p_placement_department_id, 'user.write', 'users.student_department_memberships')
        OR authz.current_context_allows(p_tenant_id, 'user.write', 'users.student_department_memberships')
    ) THEN
        RAISE EXCEPTION 'current authorization context cannot assign this placement department'
            USING ERRCODE = '42501';
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

    IF has_current THEN
        IF current_membership.department_id = p_placement_department_id THEN
            RETURN QUERY SELECT p_student_id, p_tenant_id, current_membership.department_id, current_membership.id;
            RETURN;
        END IF;
        RAISE EXCEPTION 'student already belongs to another placement department'
            USING ERRCODE = '23514';
    END IF;

    new_membership_id := COALESCE(p_membership_id, uuidv7());

    INSERT INTO users.student_department_memberships (
        id, student_id, tenant_id, department_id, department_type, status
    ) VALUES (
        new_membership_id, p_student_id, p_tenant_id, p_placement_department_id, 'placement', 'active'
    );

    UPDATE users.current_student_affiliations
    SET placement_membership_id = new_membership_id
    WHERE student_id = p_student_id AND tenant_id = p_tenant_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'student has no current affiliation row'
            USING ERRCODE = 'P0002';
    END IF;

    RETURN QUERY SELECT p_student_id, p_tenant_id, p_placement_department_id, new_membership_id;
END
$function$;

REVOKE ALL ON FUNCTION users.set_student_placement_department(uuid, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION users.set_student_placement_department(uuid, uuid, uuid, uuid) TO aether_user_app;

-- Placement officers need membership write to assign/clear tracks.
SET LOCAL users.allow_managed_change = 'on';
UPDATE users.roles
SET permissions = users.flag_bits(ARRAY[
    'VIEW_SCOPE', 'VIEW_PLACEMENT_POOL', 'VIEW_STUDENT_PII', 'VIEW_GOLD_ANALYTICS', 'MANAGE_PLACEMENT',
    'user.students.read', 'user.students.write',
    'user.student_department_memberships.read', 'user.student_department_memberships.write',
    'user.student_batch_affiliations.read', 'user.student_batch_affiliations.write'
]),
    updated_at = clock_timestamp()
WHERE system_key = 'placement_officer' AND managed;

RESET ROLE;
