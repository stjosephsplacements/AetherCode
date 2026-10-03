SET ROLE aether_user_owner;

CREATE TABLE app.inbox_messages (
    consumer_name text NOT NULL CHECK (consumer_name ~ '^[a-z][a-z0-9._-]{0,127}$'),
    message_id uuid NOT NULL,
    subject text NOT NULL CHECK (subject ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$'),
    occurred_at timestamptz NOT NULL,
    payload_sha256 bytea NOT NULL CHECK (octet_length(payload_sha256) = 32),
    received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    processed_at timestamptz,
    failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
    last_error text,
    PRIMARY KEY (consumer_name, message_id),
    CHECK (processed_at IS NULL OR processed_at >= received_at)
);
CREATE INDEX inbox_messages_pending_idx ON app.inbox_messages (received_at) WHERE processed_at IS NULL;

CREATE TABLE app.command_idempotency (
    command_scope text NOT NULL CHECK (command_scope ~ '^[a-z][a-z0-9._-]{0,127}$'),
    idempotency_key uuid NOT NULL,
    request_sha256 bytea NOT NULL CHECK (octet_length(request_sha256) = 32),
    response_code integer,
    response_body jsonb,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    completed_at timestamptz,
    expires_at timestamptz NOT NULL,
    PRIMARY KEY (command_scope, idempotency_key),
    CHECK (expires_at > created_at),
    CHECK ((completed_at IS NULL) = (response_code IS NULL)),
    CHECK (response_body IS NULL OR jsonb_typeof(response_body) = 'object')
);
CREATE INDEX command_idempotency_expiry_idx ON app.command_idempotency (expires_at);

CREATE TABLE app.outbox_events (
    event_id uuid PRIMARY KEY,
    aggregate_type text NOT NULL CHECK (aggregate_type ~ '^[a-z][a-z0-9._-]{0,127}$'),
    aggregate_id uuid NOT NULL,
    tenant_id uuid,
    event_type text NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9._-]{0,127}$'),
    schema_version integer NOT NULL CHECK (schema_version > 0),
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    payload_sha256 bytea NOT NULL CHECK (octet_length(payload_sha256) = 32),
    occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    published_at timestamptz,
    publication_attempts integer NOT NULL DEFAULT 0 CHECK (publication_attempts >= 0),
    next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    locked_until timestamptz,
    last_error text
);
CREATE INDEX outbox_events_pending_idx ON app.outbox_events (next_attempt_at, occurred_at) WHERE published_at IS NULL;

CREATE FUNCTION users.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
BEGIN
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END
$function$;

CREATE FUNCTION users.reject_tenant_move()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
BEGIN
    IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
        RAISE EXCEPTION 'tenant_id is immutable';
    END IF;
    RETURN NEW;
END
$function$;

CREATE TABLE users.profiles (
    principal_id uuid PRIMARY KEY,
    given_name text NOT NULL CHECK (char_length(btrim(given_name)) BETWEEN 1 AND 120),
    family_name text NOT NULL CHECK (char_length(btrim(family_name)) BETWEEN 1 AND 120),
    preferred_name text CHECK (preferred_name IS NULL OR char_length(btrim(preferred_name)) BETWEEN 1 AND 120),
    avatar_object_key text,
    avatar_sha256 bytea CHECK (avatar_sha256 IS NULL OR octet_length(avatar_sha256) = 32),
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK ((avatar_object_key IS NULL) = (avatar_sha256 IS NULL))
);

CREATE TABLE users.students (
    id uuid PRIMARY KEY,
    principal_id uuid NOT NULL UNIQUE,
    tenant_id uuid NOT NULL,
    enrollment_number text NOT NULL CHECK (char_length(btrim(enrollment_number)) BETWEEN 1 AND 128),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'inactive', 'withdrawn')),
    admitted_at date,
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, enrollment_number)
);
CREATE INDEX students_tenant_status_idx ON users.students (tenant_id, status);

CREATE TABLE users.role_assignments (
    id uuid PRIMARY KEY,
    principal_id uuid NOT NULL,
    role_name text NOT NULL CHECK (role_name IN (
        'super_admin', 'placement_user', 'college_admin', 'department_user', 'mentor', 'student'
    )),
    scope_kind text NOT NULL CHECK (scope_kind IN (
        'platform', 'college', 'department', 'batch', 'placement_department', 'self'
    )),
    tenant_id uuid,
    scope_id uuid,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
    active_from timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz,
    revoked_at timestamptz,
    granted_by_principal_id uuid NOT NULL,
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (expires_at IS NULL OR expires_at > active_from),
    CHECK ((status = 'active') = (revoked_at IS NULL)),
    CHECK (
        (scope_kind = 'platform' AND tenant_id IS NULL AND scope_id IS NULL)
        OR (scope_kind = 'college' AND tenant_id IS NOT NULL AND scope_id = tenant_id)
        OR (scope_kind IN ('department', 'batch') AND tenant_id IS NOT NULL AND scope_id IS NOT NULL)
        OR (scope_kind = 'placement_department' AND tenant_id IS NULL AND scope_id IS NOT NULL)
        OR (scope_kind = 'self' AND tenant_id IS NOT NULL AND scope_id = principal_id)
    ),
    CHECK (
        (role_name = 'super_admin' AND scope_kind = 'platform')
        OR (role_name = 'placement_user' AND scope_kind IN ('platform', 'placement_department'))
        OR (role_name = 'college_admin' AND scope_kind = 'college')
        OR (role_name = 'department_user' AND scope_kind = 'department')
        OR (role_name = 'mentor' AND scope_kind IN ('department', 'batch'))
        OR (role_name = 'student' AND scope_kind = 'self')
    )
);
CREATE UNIQUE INDEX role_assignments_active_unique
    ON users.role_assignments (
        principal_id,
        role_name,
        scope_kind,
        COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid)
    ) WHERE status = 'active';
CREATE INDEX role_assignments_subject_idx ON users.role_assignments (principal_id, status, expires_at);
CREATE INDEX role_assignments_tenant_idx ON users.role_assignments (tenant_id, status) WHERE tenant_id IS NOT NULL;

CREATE TABLE users.placement_department_memberships (
    id uuid PRIMARY KEY,
    principal_id uuid NOT NULL,
    placement_department_id uuid NOT NULL,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
    active_from timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz,
    revoked_at timestamptz,
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (principal_id, placement_department_id),
    CHECK (expires_at IS NULL OR expires_at > active_from),
    CHECK ((status = 'active') = (revoked_at IS NULL))
);
CREATE INDEX placement_department_memberships_active_idx
    ON users.placement_department_memberships (placement_department_id, principal_id)
    WHERE status = 'active';

CREATE TABLE users.student_department_memberships (
    id uuid PRIMARY KEY,
    student_id uuid NOT NULL REFERENCES users.students (id) ON DELETE RESTRICT,
    tenant_id uuid NOT NULL,
    department_id uuid NOT NULL,
    department_type text NOT NULL CHECK (department_type IN ('college', 'placement')),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
    active_from timestamptz NOT NULL DEFAULT clock_timestamp(),
    ended_at timestamptz,
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK ((status = 'active') = (ended_at IS NULL)),
    CHECK (ended_at IS NULL OR ended_at >= active_from)
);
CREATE UNIQUE INDEX student_department_active_college_unique
    ON users.student_department_memberships (student_id)
    WHERE department_type = 'college' AND status = 'active';
CREATE UNIQUE INDEX student_department_active_placement_unique
    ON users.student_department_memberships (student_id)
    WHERE department_type = 'placement' AND status = 'active';
CREATE INDEX student_department_memberships_tenant_idx
    ON users.student_department_memberships (tenant_id, department_type, status);

CREATE TABLE users.current_student_affiliations (
    student_id uuid PRIMARY KEY REFERENCES users.students (id) ON DELETE RESTRICT,
    tenant_id uuid NOT NULL,
    college_membership_id uuid NOT NULL UNIQUE REFERENCES users.student_department_memberships (id) ON DELETE RESTRICT,
    placement_membership_id uuid NOT NULL UNIQUE REFERENCES users.student_department_memberships (id) ON DELETE RESTRICT,
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (college_membership_id <> placement_membership_id)
);

CREATE TABLE users.mentor_batch_assignments (
    id uuid PRIMARY KEY,
    mentor_principal_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    batch_id uuid NOT NULL,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
    active_from timestamptz NOT NULL DEFAULT clock_timestamp(),
    ended_at timestamptz,
    assigned_by_principal_id uuid NOT NULL,
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (mentor_principal_id, batch_id),
    CHECK ((status = 'active') = (ended_at IS NULL)),
    CHECK (ended_at IS NULL OR ended_at >= active_from)
);
CREATE INDEX mentor_batch_assignments_tenant_idx
    ON users.mentor_batch_assignments (tenant_id, batch_id) WHERE status = 'active';

CREATE TABLE users.authz_revisions (
    principal_id uuid PRIMARY KEY,
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    change_reason text NOT NULL CHECK (change_reason ~ '^[a-z][a-z0-9._-]{0,127}$')
);

-- Casbin policy rows are canonical authorization data.  The service evaluates
-- them with active role assignments and always returns authz_revisions.revision.
CREATE TABLE users.authorization_policy_rules (
    id uuid PRIMARY KEY,
    ptype text NOT NULL CHECK (ptype ~ '^[a-z][a-z0-9_]{0,31}$'),
    v0 text,
    v1 text,
    v2 text,
    v3 text,
    v4 text,
    v5 text,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    revoked_at timestamptz,
    CHECK ((status = 'active') = (revoked_at IS NULL))
);
CREATE UNIQUE INDEX authorization_policy_rules_active_unique
    ON users.authorization_policy_rules (
        ptype,
        COALESCE(v0, ''), COALESCE(v1, ''), COALESCE(v2, ''),
        COALESCE(v3, ''), COALESCE(v4, ''), COALESCE(v5, '')
    ) WHERE status = 'active';

CREATE VIEW users.active_role_assignments
WITH (security_barrier = true, security_invoker = true)
AS
SELECT
    assignment.id,
    assignment.principal_id,
    assignment.role_name,
    assignment.scope_kind,
    assignment.tenant_id,
    assignment.scope_id,
    revision.revision AS authz_revision,
    assignment.expires_at
FROM users.role_assignments AS assignment
JOIN users.authz_revisions AS revision ON revision.principal_id = assignment.principal_id
WHERE assignment.status = 'active'
  AND (assignment.expires_at IS NULL OR assignment.expires_at > clock_timestamp());

CREATE FUNCTION users.bump_authz_revision(p_principal_id uuid, p_reason text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, users, app, extensions AS $function$
DECLARE new_revision bigint;
BEGIN
    IF p_principal_id IS NULL OR p_reason !~ '^[a-z][a-z0-9._-]{0,127}$' THEN
        RAISE EXCEPTION 'principal and valid authorization change reason are required';
    END IF;

    INSERT INTO users.authz_revisions AS revision (principal_id, revision, changed_at, change_reason)
    VALUES (p_principal_id, 1, clock_timestamp(), p_reason)
    ON CONFLICT (principal_id) DO UPDATE
    SET revision = revision.revision + 1,
        changed_at = clock_timestamp(),
        change_reason = EXCLUDED.change_reason
    RETURNING revision.revision INTO new_revision;

    INSERT INTO app.outbox_events (
        event_id, aggregate_type, aggregate_id, event_type, schema_version,
        payload, payload_sha256
    ) VALUES (
        extensions.gen_random_uuid(),
        'principal',
        p_principal_id,
        'authz.revision_changed.v1',
        1,
        jsonb_build_object('principal_id', p_principal_id, 'authz_revision', new_revision, 'reason', p_reason),
        extensions.digest(
            convert_to(jsonb_build_object('principal_id', p_principal_id, 'authz_revision', new_revision, 'reason', p_reason)::text, 'UTF8'),
            'sha256'
        )
    );

    RETURN new_revision;
END
$function$;

CREATE FUNCTION users.bump_placement_staff_revisions(p_placement_department_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, users AS $function$
DECLARE staff_record record;
BEGIN
    FOR staff_record IN
        SELECT principal_id
        FROM users.placement_department_memberships
        WHERE placement_department_id = p_placement_department_id
          AND status = 'active'
          AND (expires_at IS NULL OR expires_at > clock_timestamp())
    LOOP
        PERFORM users.bump_authz_revision(staff_record.principal_id, p_reason);
    END LOOP;
END
$function$;

CREATE FUNCTION users.validate_current_student_affiliation()
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

CREATE FUNCTION users.protect_current_affiliation_membership()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, users AS $function$
BEGIN
    IF EXISTS (
        SELECT 1 FROM users.current_student_affiliations
        WHERE college_membership_id = OLD.id OR placement_membership_id = OLD.id
    ) AND (
        NEW.status <> 'active'
        OR NEW.department_type IS DISTINCT FROM OLD.department_type
        OR NEW.student_id IS DISTINCT FROM OLD.student_id
        OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    ) THEN
        RAISE EXCEPTION 'an affiliation referenced by a current student record cannot be ended or moved';
    END IF;
    RETURN NEW;
END
$function$;

CREATE FUNCTION users.require_active_student_affiliations()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, users AS $function$
BEGIN
    IF NEW.status = 'active' AND NOT EXISTS (
        SELECT 1 FROM users.current_student_affiliations
        WHERE student_id = NEW.id AND tenant_id = NEW.tenant_id
    ) THEN
        RAISE EXCEPTION 'an active student requires current college and placement affiliations';
    END IF;
    RETURN NEW;
END
$function$;

CREATE FUNCTION users.protect_active_student_affiliation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, users AS $function$
DECLARE student_status text;
BEGIN
    SELECT status INTO student_status FROM users.students WHERE id = OLD.student_id;
    IF student_status = 'active' THEN
        RAISE EXCEPTION 'current affiliations cannot be removed while the student is active';
    END IF;
    RETURN OLD;
END
$function$;

CREATE FUNCTION users.on_role_assignment_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, users AS $function$
DECLARE affected_principal_id uuid;
BEGIN
    affected_principal_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.principal_id ELSE NEW.principal_id END;
    PERFORM users.bump_authz_revision(affected_principal_id, 'role_assignment');
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END
$function$;

CREATE FUNCTION users.on_placement_staff_membership_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, users AS $function$
DECLARE affected_principal_id uuid;
BEGIN
    affected_principal_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.principal_id ELSE NEW.principal_id END;
    PERFORM users.bump_authz_revision(affected_principal_id, 'placement_staff_membership');
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END
$function$;

CREATE FUNCTION users.on_student_department_membership_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, users AS $function$
DECLARE
    affected_student_id uuid;
    affected_principal_id uuid;
BEGIN
    affected_student_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.student_id ELSE NEW.student_id END;
    SELECT principal_id INTO affected_principal_id FROM users.students WHERE id = affected_student_id;
    PERFORM users.bump_authz_revision(affected_principal_id, 'student_department_membership');

    IF TG_OP <> 'INSERT' AND OLD.department_type = 'placement' THEN
        PERFORM users.bump_placement_staff_revisions(OLD.department_id, 'placement_student_membership');
    END IF;
    IF TG_OP <> 'DELETE' AND NEW.department_type = 'placement' THEN
        PERFORM users.bump_placement_staff_revisions(NEW.department_id, 'placement_student_membership');
    END IF;

    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END
$function$;

-- Tenant and platform grants can see a tenant's students.  A placement grant
-- can see only students currently affiliated with the same placement
-- department recorded as its effective grant source.
CREATE FUNCTION users.current_context_valid_student(
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
                        AND EXISTS (
                            SELECT 1
                            FROM users.student_department_memberships AS membership
                            WHERE membership.student_id = p_student_id
                              AND membership.tenant_id = p_tenant_id
                              AND membership.department_type = 'placement'
                              AND membership.department_id = grant_row.grant_source_id
                              AND membership.status = 'active'
                        )
                    )
              )
       )
$function$;

CREATE FUNCTION users.current_context_allows_profile(
    p_principal_id uuid,
    p_required_action text,
    p_required_resource text
)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, users, authz, app
AS $function$
    SELECT p_principal_id IS NOT NULL
       AND p_required_action IS NOT NULL
       AND p_required_resource = 'users.profiles'
       AND EXISTS (
            SELECT 1
            FROM authz.request_contexts AS context
            WHERE context.context_id = app.current_context_id()
              AND context.backend_pid = pg_backend_pid()
              AND context.transaction_id = txid_current()
              AND context.expires_at > clock_timestamp()
              AND context.action = p_required_action
              AND context.resource = p_required_resource
              AND (
                    authz.current_global_context_allows(p_required_action, p_required_resource)
                    OR (
                        context.actor_id = p_principal_id
                        AND (
                            (
                                context.tenant_id IS NOT NULL
                                AND authz.has_tenant_authorization_at(
                                    context.actor_id,
                                    context.tenant_id,
                                    context.authz_revision
                                )
                            )
                            OR authz.current_global_context_allows(
                                p_required_action,
                                p_required_resource
                            )
                        )
                    )
                    OR EXISTS (
                        SELECT 1
                        FROM users.students AS student
                        WHERE student.principal_id = p_principal_id
                          AND users.current_context_valid_student(
                                student.tenant_id,
                                student.id,
                                p_required_action,
                                p_required_resource
                          )
                    )
              )
       )
$function$;

CREATE TRIGGER profiles_touch_updated_at BEFORE UPDATE ON users.profiles
FOR EACH ROW EXECUTE FUNCTION users.touch_updated_at();
CREATE TRIGGER students_touch_updated_at BEFORE UPDATE ON users.students
FOR EACH ROW EXECUTE FUNCTION users.touch_updated_at();
CREATE TRIGGER role_assignments_touch_updated_at BEFORE UPDATE ON users.role_assignments
FOR EACH ROW EXECUTE FUNCTION users.touch_updated_at();
CREATE TRIGGER placement_staff_touch_updated_at BEFORE UPDATE ON users.placement_department_memberships
FOR EACH ROW EXECUTE FUNCTION users.touch_updated_at();
CREATE TRIGGER student_department_memberships_touch_updated_at BEFORE UPDATE ON users.student_department_memberships
FOR EACH ROW EXECUTE FUNCTION users.touch_updated_at();
CREATE TRIGGER current_student_affiliations_touch_updated_at BEFORE UPDATE ON users.current_student_affiliations
FOR EACH ROW EXECUTE FUNCTION users.touch_updated_at();
CREATE TRIGGER mentor_batch_assignments_touch_updated_at BEFORE UPDATE ON users.mentor_batch_assignments
FOR EACH ROW EXECUTE FUNCTION users.touch_updated_at();
CREATE TRIGGER current_student_affiliations_validate BEFORE INSERT OR UPDATE ON users.current_student_affiliations
FOR EACH ROW EXECUTE FUNCTION users.validate_current_student_affiliation();
CREATE TRIGGER student_memberships_protect_current BEFORE UPDATE ON users.student_department_memberships
FOR EACH ROW EXECUTE FUNCTION users.protect_current_affiliation_membership();
CREATE TRIGGER students_require_affiliations BEFORE INSERT OR UPDATE OF status, tenant_id ON users.students
FOR EACH ROW EXECUTE FUNCTION users.require_active_student_affiliations();
CREATE TRIGGER current_affiliations_protect_active_student BEFORE DELETE ON users.current_student_affiliations
FOR EACH ROW EXECUTE FUNCTION users.protect_active_student_affiliation();
CREATE TRIGGER role_assignments_bump_authz AFTER INSERT OR UPDATE OR DELETE ON users.role_assignments
FOR EACH ROW EXECUTE FUNCTION users.on_role_assignment_change();
CREATE TRIGGER placement_staff_bump_authz AFTER INSERT OR UPDATE OR DELETE ON users.placement_department_memberships
FOR EACH ROW EXECUTE FUNCTION users.on_placement_staff_membership_change();
CREATE TRIGGER student_memberships_bump_authz AFTER INSERT OR UPDATE OR DELETE ON users.student_department_memberships
FOR EACH ROW EXECUTE FUNCTION users.on_student_department_membership_change();
CREATE TRIGGER students_reject_tenant_move BEFORE UPDATE ON users.students
FOR EACH ROW EXECUTE FUNCTION users.reject_tenant_move();
CREATE TRIGGER student_memberships_reject_tenant_move BEFORE UPDATE ON users.student_department_memberships
FOR EACH ROW EXECUTE FUNCTION users.reject_tenant_move();
CREATE TRIGGER current_affiliations_reject_tenant_move BEFORE UPDATE ON users.current_student_affiliations
FOR EACH ROW EXECUTE FUNCTION users.reject_tenant_move();
CREATE TRIGGER mentor_batch_assignments_reject_tenant_move BEFORE UPDATE ON users.mentor_batch_assignments
FOR EACH ROW EXECUTE FUNCTION users.reject_tenant_move();

ALTER TABLE users.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE users.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE users.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE users.students FORCE ROW LEVEL SECURITY;
ALTER TABLE users.student_department_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE users.student_department_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE users.current_student_affiliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users.current_student_affiliations FORCE ROW LEVEL SECURITY;
ALTER TABLE users.mentor_batch_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE users.mentor_batch_assignments FORCE ROW LEVEL SECURITY;
ALTER TABLE users.role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE users.role_assignments FORCE ROW LEVEL SECURITY;
ALTER TABLE users.placement_department_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE users.placement_department_memberships FORCE ROW LEVEL SECURITY;

CREATE POLICY profiles_app_read ON users.profiles FOR SELECT TO aether_user_app
    USING (
        users.current_context_allows_profile(principal_id, 'user.read', 'users.profiles')
        OR users.current_context_allows_profile(principal_id, 'user.write', 'users.profiles')
    );
CREATE POLICY profiles_app_insert ON users.profiles FOR INSERT TO aether_user_app
    WITH CHECK (users.current_context_allows_profile(principal_id, 'user.write', 'users.profiles'));
CREATE POLICY profiles_app_update ON users.profiles FOR UPDATE TO aether_user_app
    USING (users.current_context_allows_profile(principal_id, 'user.write', 'users.profiles'))
    WITH CHECK (users.current_context_allows_profile(principal_id, 'user.write', 'users.profiles'));
CREATE POLICY profiles_app_delete ON users.profiles FOR DELETE TO aether_user_app
    USING (users.current_context_allows_profile(principal_id, 'user.write', 'users.profiles'));

CREATE POLICY students_app_read ON users.students FOR SELECT TO aether_user_app
    USING (
        users.current_context_valid_student(tenant_id, id, 'user.read', 'users.students')
        OR users.current_context_valid_student(tenant_id, id, 'user.write', 'users.students')
    );
CREATE POLICY students_app_insert ON users.students FOR INSERT TO aether_user_app
    WITH CHECK (users.current_context_valid_student(tenant_id, id, 'user.write', 'users.students'));
CREATE POLICY students_app_update ON users.students FOR UPDATE TO aether_user_app
    USING (users.current_context_valid_student(tenant_id, id, 'user.write', 'users.students'))
    WITH CHECK (users.current_context_valid_student(tenant_id, id, 'user.write', 'users.students'));
CREATE POLICY students_app_delete ON users.students FOR DELETE TO aether_user_app
    USING (users.current_context_valid_student(tenant_id, id, 'user.write', 'users.students'));

CREATE POLICY student_memberships_app_read ON users.student_department_memberships FOR SELECT TO aether_user_app
    USING (
        users.current_context_valid_student(tenant_id, student_id, 'user.read', 'users.student_department_memberships')
        OR users.current_context_valid_student(tenant_id, student_id, 'user.write', 'users.student_department_memberships')
    );
CREATE POLICY student_memberships_app_insert ON users.student_department_memberships FOR INSERT TO aether_user_app
    WITH CHECK (users.current_context_valid_student(tenant_id, student_id, 'user.write', 'users.student_department_memberships'));
CREATE POLICY student_memberships_app_update ON users.student_department_memberships FOR UPDATE TO aether_user_app
    USING (users.current_context_valid_student(tenant_id, student_id, 'user.write', 'users.student_department_memberships'))
    WITH CHECK (users.current_context_valid_student(tenant_id, student_id, 'user.write', 'users.student_department_memberships'));
CREATE POLICY student_memberships_app_delete ON users.student_department_memberships FOR DELETE TO aether_user_app
    USING (users.current_context_valid_student(tenant_id, student_id, 'user.write', 'users.student_department_memberships'));

CREATE POLICY current_affiliations_app_read ON users.current_student_affiliations FOR SELECT TO aether_user_app
    USING (
        users.current_context_valid_student(tenant_id, student_id, 'user.read', 'users.current_student_affiliations')
        OR users.current_context_valid_student(tenant_id, student_id, 'user.write', 'users.current_student_affiliations')
    );
CREATE POLICY current_affiliations_app_insert ON users.current_student_affiliations FOR INSERT TO aether_user_app
    WITH CHECK (users.current_context_valid_student(tenant_id, student_id, 'user.write', 'users.current_student_affiliations'));
CREATE POLICY current_affiliations_app_update ON users.current_student_affiliations FOR UPDATE TO aether_user_app
    USING (users.current_context_valid_student(tenant_id, student_id, 'user.write', 'users.current_student_affiliations'))
    WITH CHECK (users.current_context_valid_student(tenant_id, student_id, 'user.write', 'users.current_student_affiliations'));
CREATE POLICY current_affiliations_app_delete ON users.current_student_affiliations FOR DELETE TO aether_user_app
    USING (users.current_context_valid_student(tenant_id, student_id, 'user.write', 'users.current_student_affiliations'));

CREATE POLICY mentor_batch_assignments_app_read ON users.mentor_batch_assignments FOR SELECT TO aether_user_app
    USING (
        authz.current_context_allows(tenant_id, 'user.read', 'users.mentor_batch_assignments')
        OR authz.current_context_allows(tenant_id, 'user.write', 'users.mentor_batch_assignments')
    );
CREATE POLICY mentor_batch_assignments_app_insert ON users.mentor_batch_assignments FOR INSERT TO aether_user_app
    WITH CHECK (authz.current_context_allows(tenant_id, 'user.write', 'users.mentor_batch_assignments'));
CREATE POLICY mentor_batch_assignments_app_update ON users.mentor_batch_assignments FOR UPDATE TO aether_user_app
    USING (authz.current_context_allows(tenant_id, 'user.write', 'users.mentor_batch_assignments'))
    WITH CHECK (authz.current_context_allows(tenant_id, 'user.write', 'users.mentor_batch_assignments'));
CREATE POLICY mentor_batch_assignments_app_delete ON users.mentor_batch_assignments FOR DELETE TO aether_user_app
    USING (authz.current_context_allows(tenant_id, 'user.write', 'users.mentor_batch_assignments'));

CREATE POLICY role_assignments_app_read ON users.role_assignments FOR SELECT TO aether_user_app
    USING (
        (tenant_id IS NOT NULL AND (
            authz.current_context_allows(tenant_id, 'user.read', 'users.role_assignments')
            OR authz.current_context_allows(tenant_id, 'user.write', 'users.role_assignments')
        ))
        OR (scope_kind = 'placement_department' AND (
            authz.current_context_allows_placement(scope_id, 'user.read', 'users.role_assignments')
            OR authz.current_context_allows_placement(scope_id, 'user.write', 'users.role_assignments')
        ))
        OR (tenant_id IS NULL AND (
            authz.current_global_context_allows('user.read', 'users.role_assignments')
            OR authz.current_global_context_allows('user.write', 'users.role_assignments')
        ))
    );
CREATE POLICY role_assignments_app_insert ON users.role_assignments FOR INSERT TO aether_user_app
    WITH CHECK (
        (tenant_id IS NOT NULL AND authz.current_context_allows(tenant_id, 'user.write', 'users.role_assignments'))
        OR (scope_kind = 'placement_department' AND authz.current_context_allows_placement(scope_id, 'user.write', 'users.role_assignments'))
        OR (tenant_id IS NULL AND authz.current_global_context_allows('user.write', 'users.role_assignments'))
    );
CREATE POLICY role_assignments_app_update ON users.role_assignments FOR UPDATE TO aether_user_app
    USING (
        (tenant_id IS NOT NULL AND authz.current_context_allows(tenant_id, 'user.write', 'users.role_assignments'))
        OR (scope_kind = 'placement_department' AND authz.current_context_allows_placement(scope_id, 'user.write', 'users.role_assignments'))
        OR (tenant_id IS NULL AND authz.current_global_context_allows('user.write', 'users.role_assignments'))
    ) WITH CHECK (
        (tenant_id IS NOT NULL AND authz.current_context_allows(tenant_id, 'user.write', 'users.role_assignments'))
        OR (scope_kind = 'placement_department' AND authz.current_context_allows_placement(scope_id, 'user.write', 'users.role_assignments'))
        OR (tenant_id IS NULL AND authz.current_global_context_allows('user.write', 'users.role_assignments'))
    );
CREATE POLICY role_assignments_app_delete ON users.role_assignments FOR DELETE TO aether_user_app
    USING (
        (tenant_id IS NOT NULL AND authz.current_context_allows(tenant_id, 'user.write', 'users.role_assignments'))
        OR (scope_kind = 'placement_department' AND authz.current_context_allows_placement(scope_id, 'user.write', 'users.role_assignments'))
        OR (tenant_id IS NULL AND authz.current_global_context_allows('user.write', 'users.role_assignments'))
    );

CREATE POLICY placement_staff_app_read ON users.placement_department_memberships FOR SELECT TO aether_user_app
    USING (
        authz.current_context_allows_placement(placement_department_id, 'user.read', 'users.placement_department_memberships')
        OR authz.current_context_allows_placement(placement_department_id, 'user.write', 'users.placement_department_memberships')
        OR authz.current_global_context_allows('user.read', 'users.placement_department_memberships')
        OR authz.current_global_context_allows('user.write', 'users.placement_department_memberships')
    );
CREATE POLICY placement_staff_app_insert ON users.placement_department_memberships FOR INSERT TO aether_user_app
    WITH CHECK (
        authz.current_context_allows_placement(placement_department_id, 'user.write', 'users.placement_department_memberships')
        OR authz.current_global_context_allows('user.write', 'users.placement_department_memberships')
    );
CREATE POLICY placement_staff_app_update ON users.placement_department_memberships FOR UPDATE TO aether_user_app
    USING (
        authz.current_context_allows_placement(placement_department_id, 'user.write', 'users.placement_department_memberships')
        OR authz.current_global_context_allows('user.write', 'users.placement_department_memberships')
    ) WITH CHECK (
        authz.current_context_allows_placement(placement_department_id, 'user.write', 'users.placement_department_memberships')
        OR authz.current_global_context_allows('user.write', 'users.placement_department_memberships')
    );
CREATE POLICY placement_staff_app_delete ON users.placement_department_memberships FOR DELETE TO aether_user_app
    USING (
        authz.current_context_allows_placement(placement_department_id, 'user.write', 'users.placement_department_memberships')
        OR authz.current_global_context_allows('user.write', 'users.placement_department_memberships')
    );

CREATE POLICY profiles_owner_maintenance ON users.profiles FOR ALL TO aether_user_owner USING (true) WITH CHECK (true);
CREATE POLICY students_owner_maintenance ON users.students FOR ALL TO aether_user_owner USING (true) WITH CHECK (true);
CREATE POLICY student_memberships_owner_maintenance ON users.student_department_memberships FOR ALL TO aether_user_owner USING (true) WITH CHECK (true);
CREATE POLICY current_affiliations_owner_maintenance ON users.current_student_affiliations FOR ALL TO aether_user_owner USING (true) WITH CHECK (true);
CREATE POLICY mentor_batch_assignments_owner_maintenance ON users.mentor_batch_assignments FOR ALL TO aether_user_owner USING (true) WITH CHECK (true);
CREATE POLICY role_assignments_owner_maintenance ON users.role_assignments FOR ALL TO aether_user_owner USING (true) WITH CHECK (true);
CREATE POLICY placement_staff_owner_maintenance ON users.placement_department_memberships FOR ALL TO aether_user_owner USING (true) WITH CHECK (true);

-- The central user authorization process receives the dedicated reader role;
-- it is not granted to request-serving application connections.  It can derive
-- a decision and revision without becoming a table owner or BYPASSRLS role.
CREATE POLICY students_authz_reader ON users.students FOR SELECT TO aether_user_authz_reader USING (true);
CREATE POLICY profiles_authz_reader ON users.profiles FOR SELECT TO aether_user_authz_reader USING (true);
CREATE POLICY student_memberships_authz_reader ON users.student_department_memberships FOR SELECT TO aether_user_authz_reader USING (true);
CREATE POLICY current_affiliations_authz_reader ON users.current_student_affiliations FOR SELECT TO aether_user_authz_reader USING (true);
CREATE POLICY mentor_batch_assignments_authz_reader ON users.mentor_batch_assignments FOR SELECT TO aether_user_authz_reader USING (true);
CREATE POLICY role_assignments_authz_reader ON users.role_assignments FOR SELECT TO aether_user_authz_reader USING (true);
CREATE POLICY placement_staff_authz_reader ON users.placement_department_memberships FOR SELECT TO aether_user_authz_reader USING (true);

REVOKE ALL ON ALL TABLES IN SCHEMA app FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA users FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA app FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA users FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA users FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON app.inbox_messages, app.command_idempotency, app.outbox_events TO aether_user_app;
GRANT SELECT, INSERT, UPDATE ON users.profiles, users.students, users.role_assignments,
    users.placement_department_memberships, users.student_department_memberships,
    users.current_student_affiliations, users.mentor_batch_assignments,
    users.authorization_policy_rules TO aether_user_app;
GRANT SELECT ON users.authz_revisions, users.active_role_assignments TO aether_user_app;
GRANT EXECUTE ON FUNCTION users.current_context_valid_student(uuid, uuid, text, text) TO aether_user_app;
GRANT EXECUTE ON FUNCTION users.current_context_allows_profile(uuid, text, text) TO aether_user_app;
GRANT SELECT ON users.profiles, users.students, users.role_assignments, users.placement_department_memberships,
    users.student_department_memberships, users.current_student_affiliations,
    users.mentor_batch_assignments, users.authz_revisions,
    users.authorization_policy_rules, users.active_role_assignments
    TO aether_user_authz_reader;

RESET ROLE;
