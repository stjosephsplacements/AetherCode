-- Discord-style roles, permission bit flags and overwrites (ADR-0066). Expand only:
-- nothing here changes an authorization decision. The Casbin policy and the role_name
-- enum stay authoritative until the cutover (AUTHZ_ENGINE) and the contract migration.
SET ROLE aether_user_owner;

-- The flag registry: a permission is the bit at its index in a bit(256). Append-only, so an
-- index can never be reassigned; a retired flag is simply no longer used.
CREATE TABLE users.permission_flags (
    key text PRIMARY KEY CHECK (key ~ '^[A-Za-z][A-Za-z0-9_.-]{1,95}$'),
    bit_index smallint NOT NULL UNIQUE CHECK (bit_index BETWEEN 0 AND 255),
    kind text NOT NULL CHECK (kind IN ('meta', 'resource')),
    elevated boolean NOT NULL DEFAULT false,
    platform_only boolean NOT NULL DEFAULT false
);

CREATE FUNCTION users.permission_flags_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, users AS $function$
BEGIN
    RAISE EXCEPTION 'permission flags are append-only' USING ERRCODE = '55000';
END
$function$;
CREATE TRIGGER permission_flags_append_only BEFORE UPDATE OR DELETE ON users.permission_flags
    FOR EACH ROW EXECUTE FUNCTION users.permission_flags_append_only();

INSERT INTO users.permission_flags (key, bit_index, kind, elevated, platform_only) VALUES
    ('ADMINISTRATOR', 0, 'meta', true, false),
    ('VIEW_SCOPE', 1, 'meta', false, false),
    ('MANAGE_ROLES', 2, 'meta', true, false),
    ('MANAGE_OVERWRITES', 3, 'meta', true, false),
    ('MANAGE_MEMBERS', 4, 'meta', false, false),
    ('MANAGE_STRUCTURE', 5, 'meta', false, false),
    ('VIEW_AUDIT', 6, 'meta', false, false),
    ('VIEW_STUDENT_PII', 7, 'meta', true, false),
    ('VIEW_PLACEMENT_POOL', 8, 'meta', false, false),
    ('MANAGE_PLACEMENT', 9, 'meta', false, false),
    ('EXPORT_DATA', 10, 'meta', true, false),
    ('VIEW_GOLD_ANALYTICS', 11, 'meta', false, false),
    ('analytics.batch_progress_rollups.read', 16, 'resource', false, false),
    ('analytics.batch_progress_rollups.write', 17, 'resource', false, false),
    ('analytics.batch_progress_rollups.delete', 18, 'resource', false, false),
    ('analytics.event_facts.read', 19, 'resource', false, false),
    ('analytics.event_facts.write', 20, 'resource', false, false),
    ('analytics.event_facts.delete', 21, 'resource', false, false),
    ('analytics.exam_result_rollups.read', 22, 'resource', false, false),
    ('analytics.exam_result_rollups.write', 23, 'resource', false, false),
    ('analytics.exam_result_rollups.delete', 24, 'resource', false, false),
    ('analytics.placement_student_rollups.read', 25, 'resource', false, false),
    ('analytics.placement_student_rollups.write', 26, 'resource', false, false),
    ('analytics.placement_student_rollups.delete', 27, 'resource', false, false),
    ('analytics.report_exports.read', 28, 'resource', false, false),
    ('analytics.report_exports.write', 29, 'resource', false, false),
    ('analytics.report_exports.delete', 30, 'resource', false, false),
    ('analytics.student_progress_rollups.read', 31, 'resource', false, false),
    ('analytics.student_progress_rollups.write', 32, 'resource', false, false),
    ('analytics.student_progress_rollups.delete', 33, 'resource', false, false),
    ('assessment.assignment_rules.read', 34, 'resource', false, false),
    ('assessment.assignment_rules.write', 35, 'resource', false, false),
    ('assessment.assignment_rules.delete', 36, 'resource', false, false),
    ('assessment.candidate_assignments.read', 37, 'resource', false, false),
    ('assessment.candidate_assignments.write', 38, 'resource', false, false),
    ('assessment.candidate_assignments.delete', 39, 'resource', false, false),
    ('assessment.exam_events.read', 40, 'resource', false, false),
    ('assessment.exam_events.write', 41, 'resource', false, false),
    ('assessment.exam_events.delete', 42, 'resource', false, false),
    ('assessment.exam_items.read', 43, 'resource', false, false),
    ('assessment.exam_items.write', 44, 'resource', false, false),
    ('assessment.exam_items.delete', 45, 'resource', false, false),
    ('assessment.exam_sections.read', 46, 'resource', false, false),
    ('assessment.exam_sections.write', 47, 'resource', false, false),
    ('assessment.exam_sections.delete', 48, 'resource', false, false),
    ('assessment.exam_versions.read', 49, 'resource', false, false),
    ('assessment.exam_versions.write', 50, 'resource', false, false),
    ('assessment.exam_versions.delete', 51, 'resource', false, false),
    ('assessment.exams.read', 52, 'resource', false, false),
    ('assessment.exams.write', 53, 'resource', false, false),
    ('assessment.exams.delete', 54, 'resource', false, false),
    ('assessment.proctor_policies.read', 55, 'resource', false, false),
    ('assessment.proctor_policies.write', 56, 'resource', false, false),
    ('assessment.proctor_policies.delete', 57, 'resource', false, false),
    ('assessment.proctor_policy_versions.read', 58, 'resource', false, false),
    ('assessment.proctor_policy_versions.write', 59, 'resource', false, false),
    ('assessment.proctor_policy_versions.delete', 60, 'resource', false, false),
    ('notification.community.read', 61, 'resource', false, false),
    ('notification.community.write', 62, 'resource', false, false),
    ('notification.community.delete', 63, 'resource', false, false),
    ('notification.community_moderation.read', 64, 'resource', false, false),
    ('notification.community_moderation.write', 65, 'resource', false, false),
    ('notification.community_moderation.delete', 66, 'resource', false, false),
    ('notification.delivery_attempts.read', 67, 'resource', false, false),
    ('notification.delivery_attempts.write', 68, 'resource', false, false),
    ('notification.delivery_attempts.delete', 69, 'resource', false, false),
    ('notification.notifications.read', 70, 'resource', false, false),
    ('notification.notifications.write', 71, 'resource', false, false),
    ('notification.notifications.delete', 72, 'resource', false, false),
    ('notification.provider_idempotency_records.read', 73, 'resource', false, false),
    ('notification.provider_idempotency_records.write', 74, 'resource', false, false),
    ('notification.provider_idempotency_records.delete', 75, 'resource', false, false),
    ('notification.recipient_preferences.read', 76, 'resource', false, false),
    ('notification.recipient_preferences.write', 77, 'resource', false, false),
    ('notification.recipient_preferences.delete', 78, 'resource', false, false),
    ('question-bank.categories.read', 79, 'resource', false, false),
    ('question-bank.categories.write', 80, 'resource', false, false),
    ('question-bank.categories.delete', 81, 'resource', false, false),
    ('question-bank.category_management.read', 82, 'resource', false, true),
    ('question-bank.category_management.write', 83, 'resource', false, true),
    ('question-bank.category_management.delete', 84, 'resource', false, true),
    ('question-bank.practice_submissions.read', 85, 'resource', false, false),
    ('question-bank.practice_submissions.write', 86, 'resource', false, false),
    ('question-bank.practice_submissions.delete', 87, 'resource', false, false),
    ('question-bank.question_assets.read', 88, 'resource', false, false),
    ('question-bank.question_assets.write', 89, 'resource', false, false),
    ('question-bank.question_assets.delete', 90, 'resource', false, false),
    ('question-bank.question_exports.read', 91, 'resource', false, true),
    ('question-bank.question_exports.write', 92, 'resource', false, true),
    ('question-bank.question_exports.delete', 93, 'resource', false, true),
    ('question-bank.question_version_tags.read', 94, 'resource', false, false),
    ('question-bank.question_version_tags.write', 95, 'resource', false, false),
    ('question-bank.question_version_tags.delete', 96, 'resource', false, false),
    ('question-bank.question_versions.read', 97, 'resource', false, false),
    ('question-bank.question_versions.write', 98, 'resource', false, false),
    ('question-bank.question_versions.delete', 99, 'resource', false, false),
    ('question-bank.questions.read', 100, 'resource', false, false),
    ('question-bank.questions.write', 101, 'resource', false, false),
    ('question-bank.questions.delete', 102, 'resource', false, false),
    ('question-bank.tags.read', 103, 'resource', false, false),
    ('question-bank.tags.write', 104, 'resource', false, false),
    ('question-bank.tags.delete', 105, 'resource', false, false),
    ('question-bank.test_case_manifests.read', 106, 'resource', false, false),
    ('question-bank.test_case_manifests.write', 107, 'resource', false, false),
    ('question-bank.test_case_manifests.delete', 108, 'resource', false, false),
    ('seb.configurations.read', 109, 'resource', false, false),
    ('seb.configurations.write', 110, 'resource', false, false),
    ('seb.configurations.delete', 111, 'resource', false, false),
    ('seb.key_rotations.read', 112, 'resource', false, false),
    ('seb.key_rotations.write', 113, 'resource', false, false),
    ('seb.key_rotations.delete', 114, 'resource', false, false),
    ('seb.sessions.read', 115, 'resource', false, false),
    ('seb.sessions.write', 116, 'resource', false, false),
    ('seb.sessions.delete', 117, 'resource', false, false),
    ('seb.validation_events.read', 118, 'resource', false, false),
    ('seb.validation_events.write', 119, 'resource', false, false),
    ('seb.validation_events.delete', 120, 'resource', false, false),
    ('submission.answer_revisions.read', 121, 'resource', false, false),
    ('submission.answer_revisions.write', 122, 'resource', false, false),
    ('submission.answer_revisions.delete', 123, 'resource', false, false),
    ('submission.attempt_events.read', 124, 'resource', false, false),
    ('submission.attempt_events.write', 125, 'resource', false, false),
    ('submission.attempt_events.delete', 126, 'resource', false, false),
    ('submission.attempts.read', 127, 'resource', false, false),
    ('submission.attempts.write', 128, 'resource', false, false),
    ('submission.attempts.delete', 129, 'resource', false, false),
    ('submission.evaluation_requests.read', 130, 'resource', false, false),
    ('submission.evaluation_requests.write', 131, 'resource', false, false),
    ('submission.evaluation_requests.delete', 132, 'resource', false, false),
    ('submission.judge_receipts.read', 133, 'resource', false, false),
    ('submission.judge_receipts.write', 134, 'resource', false, false),
    ('submission.judge_receipts.delete', 135, 'resource', false, false),
    ('submission.score_summaries.read', 136, 'resource', false, false),
    ('submission.score_summaries.write', 137, 'resource', false, false),
    ('submission.score_summaries.delete', 138, 'resource', false, false),
    ('tenant.batches.read', 139, 'resource', false, false),
    ('tenant.batches.write', 140, 'resource', false, false),
    ('tenant.batches.delete', 141, 'resource', false, false),
    ('tenant.departments.read', 142, 'resource', false, false),
    ('tenant.departments.write', 143, 'resource', false, false),
    ('tenant.departments.delete', 144, 'resource', false, false),
    ('tenant.legal_holds.read', 145, 'resource', false, false),
    ('tenant.legal_holds.write', 146, 'resource', false, false),
    ('tenant.legal_holds.delete', 147, 'resource', false, false),
    ('tenant.placement_organizations.read', 148, 'resource', false, true),
    ('tenant.placement_organizations.write', 149, 'resource', false, true),
    ('tenant.placement_organizations.delete', 150, 'resource', false, true),
    ('tenant.provisioning_requests.read', 151, 'resource', false, true),
    ('tenant.provisioning_requests.write', 152, 'resource', false, true),
    ('tenant.provisioning_requests.delete', 153, 'resource', false, true),
    ('tenant.retention_policies.read', 154, 'resource', false, false),
    ('tenant.retention_policies.write', 155, 'resource', false, false),
    ('tenant.retention_policies.delete', 156, 'resource', false, false),
    ('tenant.tenants.read', 157, 'resource', false, true),
    ('tenant.tenants.write', 158, 'resource', false, true),
    ('tenant.tenants.delete', 159, 'resource', false, true),
    ('user.accounts.read', 160, 'resource', false, false),
    ('user.accounts.write', 161, 'resource', false, false),
    ('user.accounts.delete', 162, 'resource', false, false),
    ('user.current_student_affiliations.read', 163, 'resource', false, false),
    ('user.current_student_affiliations.write', 164, 'resource', false, false),
    ('user.current_student_affiliations.delete', 165, 'resource', false, false),
    ('user.mentor_batch_assignments.read', 166, 'resource', false, false),
    ('user.mentor_batch_assignments.write', 167, 'resource', false, false),
    ('user.mentor_batch_assignments.delete', 168, 'resource', false, false),
    ('user.permission_grants.read', 169, 'resource', false, true),
    ('user.permission_grants.write', 170, 'resource', false, true),
    ('user.permission_grants.delete', 171, 'resource', false, true),
    ('user.placement_department_memberships.read', 172, 'resource', false, false),
    ('user.placement_department_memberships.write', 173, 'resource', false, false),
    ('user.placement_department_memberships.delete', 174, 'resource', false, false),
    ('user.profiles.read', 175, 'resource', false, false),
    ('user.profiles.write', 176, 'resource', false, false),
    ('user.profiles.delete', 177, 'resource', false, false),
    ('user.role_assignments.read', 178, 'resource', false, true),
    ('user.role_assignments.write', 179, 'resource', false, true),
    ('user.role_assignments.delete', 180, 'resource', false, true),
    ('user.staff_audit.read', 181, 'resource', false, false),
    ('user.staff_audit.write', 182, 'resource', false, false),
    ('user.staff_audit.delete', 183, 'resource', false, false),
    ('user.student_batch_affiliations.read', 184, 'resource', false, false),
    ('user.student_batch_affiliations.write', 185, 'resource', false, false),
    ('user.student_batch_affiliations.delete', 186, 'resource', false, false),
    ('user.student_department_memberships.read', 187, 'resource', false, false),
    ('user.student_department_memberships.write', 188, 'resource', false, false),
    ('user.student_department_memberships.delete', 189, 'resource', false, false),
    ('user.students.read', 190, 'resource', false, false),
    ('user.students.write', 191, 'resource', false, false),
    ('user.students.delete', 192, 'resource', false, false);

-- A permission set from flag keys, in the bit(256) text form the Go library writes
-- (character i is flag index i).
CREATE FUNCTION users.flag_bits(p_keys text[])
RETURNS bit(256) LANGUAGE sql STABLE SET search_path = pg_catalog, users AS $function$
    SELECT COALESCE(
        (SELECT string_agg(CASE WHEN f.bit_index IS NOT NULL THEN '1' ELSE '0' END, '' ORDER BY g.i)
         FROM generate_series(0, 255) AS g(i)
         LEFT JOIN users.permission_flags f ON f.bit_index = g.i AND f.key = ANY (p_keys)),
        repeat('0', 256))::bit(256);
$function$;

-- Roles are rows (ADR-0066). A guild is the platform, one college, or the placement tree.
CREATE TABLE users.roles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    guild_kind text NOT NULL CHECK (guild_kind IN ('platform', 'college', 'placement')),
    tenant_id uuid,
    tier smallint NOT NULL CHECK (tier BETWEEN 1 AND 3), -- 1 bronze, 2 silver, 3 gold
    name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 64),
    position integer NOT NULL CHECK (position BETWEEN 0 AND 1000),
    permissions bit(256) NOT NULL,
    managed boolean NOT NULL DEFAULT false,
    system_key text CHECK (system_key ~ '^[a-z_]{2,32}$'),
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK ((guild_kind = 'college') = (tenant_id IS NOT NULL)),
    CHECK (NOT managed OR system_key IS NOT NULL)
);
CREATE UNIQUE INDEX roles_name_unique ON users.roles (guild_kind, COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
CREATE UNIQUE INDEX roles_system_key_unique ON users.roles (guild_kind, COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), system_key) WHERE system_key IS NOT NULL;

-- Managed roles (owner, everyone, student, and the seeded staff roles) change only through a
-- migration that opts in with SET LOCAL users.allow_managed_change = 'on'.
CREATE FUNCTION users.protect_managed_role()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, users AS $function$
BEGIN
    IF OLD.managed AND COALESCE(current_setting('users.allow_managed_change', true), 'off') <> 'on' THEN
        RAISE EXCEPTION 'managed roles cannot be changed or deleted' USING ERRCODE = '55000';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$function$;
CREATE TRIGGER roles_protect_managed BEFORE UPDATE OR DELETE ON users.roles
    FOR EACH ROW EXECUTE FUNCTION users.protect_managed_role();

-- Overwrites adjust a role's or a member's permissions at one scope node. Allow and deny never overlap.
CREATE TABLE users.permission_overwrites (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    node_kind text NOT NULL CHECK (node_kind IN ('platform', 'college', 'department', 'batch', 'placement_organization', 'placement_department')),
    node_id uuid,
    tenant_id uuid,
    target_kind text NOT NULL CHECK (target_kind IN ('role', 'member')),
    target_id uuid NOT NULL,
    allow bit(256) NOT NULL DEFAULT repeat('0', 256)::bit(256),
    deny bit(256) NOT NULL DEFAULT repeat('0', 256)::bit(256),
    granted_by_principal_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK ((allow & deny) = repeat('0', 256)::bit(256)),
    CHECK ((node_kind = 'platform') = (node_id IS NULL)),
    CHECK ((node_kind IN ('college', 'department', 'batch')) = (tenant_id IS NOT NULL))
);
CREATE UNIQUE INDEX permission_overwrites_unique ON users.permission_overwrites
    (node_kind, COALESCE(node_id, '00000000-0000-0000-0000-000000000000'::uuid), target_kind, target_id);
CREATE INDEX permission_overwrites_target_idx ON users.permission_overwrites (target_kind, target_id);

-- An assignment points at its role row once the backfill has run; the existing scope columns are the node.
ALTER TABLE users.role_assignments ADD COLUMN role_id uuid REFERENCES users.roles (id);
CREATE INDEX role_assignments_role_id_idx ON users.role_assignments (role_id) WHERE role_id IS NOT NULL;

-- The managed roles of one guild. The permission sets reproduce what the Casbin seeds allow today
-- (migrations 000003 and 000013); the shadow comparison finds any difference before cutover.
CREATE FUNCTION users.ensure_guild_roles(p_guild text, p_tenant uuid)
RETURNS void LANGUAGE plpgsql SET search_path = pg_catalog, users AS $function$
DECLARE
    everyone bit(256) := users.flag_bits(ARRAY['VIEW_SCOPE']);
    staff_read bit(256);
    staff_all bit(256);
    unlisted bit(256);
BEGIN
    IF (p_guild = 'college') <> (p_tenant IS NOT NULL) THEN
        RAISE EXCEPTION 'a college guild needs a tenant, the others none' USING ERRCODE = '22023';
    END IF;

    -- Resource flags a staff role may hold: everything except what only college administrators or the
    -- platform may touch (platform-only resources, the staff audit log, exports, category management).
    SELECT COALESCE(string_agg(CASE WHEN f.bit_index IS NOT NULL THEN '1' ELSE '0' END, '' ORDER BY g.i), repeat('0', 256))::bit(256)
      INTO staff_all
      FROM generate_series(0, 255) AS g(i)
      LEFT JOIN users.permission_flags f ON f.bit_index = g.i AND f.kind = 'resource' AND NOT f.platform_only
        AND f.key NOT LIKE 'user.staff_audit.%' AND f.key NOT LIKE 'question-bank.question_exports.%'
        AND f.key NOT LIKE 'question-bank.category_management.%';
    SELECT COALESCE(string_agg(CASE WHEN f.bit_index IS NOT NULL THEN '1' ELSE '0' END, '' ORDER BY g.i), repeat('0', 256))::bit(256)
      INTO staff_read
      FROM generate_series(0, 255) AS g(i)
      LEFT JOIN users.permission_flags f ON f.bit_index = g.i AND f.kind = 'resource' AND NOT f.platform_only AND f.key LIKE '%.read'
        AND f.key NOT LIKE 'user.staff_audit.%' AND f.key NOT LIKE 'question-bank.question_exports.%'
        AND f.key NOT LIKE 'question-bank.category_management.%';
    SELECT COALESCE(string_agg(CASE WHEN f.bit_index IS NOT NULL THEN '1' ELSE '0' END, '' ORDER BY g.i), repeat('0', 256))::bit(256)
      INTO unlisted
      FROM generate_series(0, 255) AS g(i)
      LEFT JOIN users.permission_flags f ON f.bit_index = g.i AND f.kind = 'resource'
        AND (f.key LIKE 'user.profiles.%' OR f.key LIKE 'user.accounts.%' OR f.key LIKE 'submission.answer_revisions.%'
             OR f.key LIKE 'submission.judge_receipts.%' OR f.key LIKE 'submission.evaluation_requests.%'
             OR f.key LIKE 'notification.provider_idempotency_records.%' OR f.key LIKE 'notification.delivery_attempts.%'
             OR f.key LIKE 'notification.recipient_preferences.%' OR f.key LIKE 'seb.sessions.%' OR f.key LIKE 'seb.validation_events.%'
             OR f.key LIKE 'seb.key_rotations.%' OR f.key LIKE 'assessment.exam_events.%');

    IF p_guild = 'platform' THEN
        INSERT INTO users.roles (guild_kind, tenant_id, tier, name, position, permissions, managed, system_key) VALUES
            ('platform', NULL, 3, 'Owner', 1000, users.flag_bits(ARRAY['ADMINISTRATOR', 'VIEW_SCOPE']) | staff_all, true, 'owner'),
            ('platform', NULL, 3, 'Super admin', 900, everyone | unlisted, true, 'super_admin'),
            ('platform', NULL, 3, '@everyone', 0, everyone, true, 'everyone')
        ON CONFLICT DO NOTHING;
    ELSIF p_guild = 'placement' THEN
        INSERT INTO users.roles (guild_kind, tenant_id, tier, name, position, permissions, managed, system_key) VALUES
            ('placement', NULL, 3, 'Placement officer', 800,
             users.flag_bits(ARRAY['VIEW_SCOPE', 'VIEW_PLACEMENT_POOL', 'VIEW_STUDENT_PII', 'VIEW_GOLD_ANALYTICS',
                                   'user.students.read', 'user.student_batch_affiliations.read', 'user.student_batch_affiliations.write']),
             true, 'placement_officer'),
            ('placement', NULL, 3, '@everyone', 0, everyone, true, 'everyone')
        ON CONFLICT DO NOTHING;
    ELSE
        INSERT INTO users.roles (guild_kind, tenant_id, tier, name, position, permissions, managed, system_key) VALUES
            ('college', p_tenant, 2, 'College admin', 500, users.flag_bits(ARRAY['ADMINISTRATOR', 'VIEW_SCOPE']) | staff_all, true, 'college_admin'),
            ('college', p_tenant, 2, 'Department user', 300, everyone | staff_all, true, 'department_user'),
            ('college', p_tenant, 1, 'Mentor', 200, everyone | staff_read, true, 'mentor'),
            ('college', p_tenant, 1, 'Student', 100,
             users.flag_bits(ARRAY['VIEW_SCOPE', 'user.students.read', 'user.profiles.read', 'user.profiles.write',
                                   'assessment.candidate_assignments.read', 'submission.attempts.read', 'submission.attempts.write',
                                   'notification.recipient_preferences.read', 'notification.recipient_preferences.write',
                                   'notification.notifications.read', 'notification.community.read', 'notification.community.write',
                                   'question-bank.practice_submissions.read', 'question-bank.practice_submissions.write',
                                   'seb.sessions.read', 'seb.validation_events.read', 'seb.validation_events.write']),
             true, 'student'),
            ('college', p_tenant, 1, '@everyone', 0, everyone, true, 'everyone')
        ON CONFLICT DO NOTHING;
    END IF;
END
$function$;
REVOKE ALL ON FUNCTION users.ensure_guild_roles(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION users.flag_bits(text[]) FROM PUBLIC;

SELECT users.ensure_guild_roles('platform', NULL);
SELECT users.ensure_guild_roles('placement', NULL);
SELECT users.ensure_guild_roles('college', tenant_id)
  FROM (SELECT tenant_id FROM users.role_assignments WHERE tenant_id IS NOT NULL
        UNION SELECT tenant_id FROM users.students) AS tenants;

-- Read access: the maintenance role and the authorization reader. Application writes arrive with
-- the role endpoints, with their own policies and the hierarchy triggers.
ALTER TABLE users.permission_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE users.permission_flags FORCE ROW LEVEL SECURITY;
ALTER TABLE users.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE users.roles FORCE ROW LEVEL SECURITY;
ALTER TABLE users.permission_overwrites ENABLE ROW LEVEL SECURITY;
ALTER TABLE users.permission_overwrites FORCE ROW LEVEL SECURITY;

CREATE POLICY permission_flags_owner_maintenance ON users.permission_flags FOR ALL TO aether_user_owner USING (true) WITH CHECK (true);
CREATE POLICY permission_flags_authz_reader ON users.permission_flags FOR SELECT TO aether_user_authz_reader USING (true);
CREATE POLICY roles_owner_maintenance ON users.roles FOR ALL TO aether_user_owner USING (true) WITH CHECK (true);
CREATE POLICY roles_authz_reader ON users.roles FOR SELECT TO aether_user_authz_reader USING (true);
CREATE POLICY permission_overwrites_owner_maintenance ON users.permission_overwrites FOR ALL TO aether_user_owner USING (true) WITH CHECK (true);
CREATE POLICY permission_overwrites_authz_reader ON users.permission_overwrites FOR SELECT TO aether_user_authz_reader USING (true);

GRANT SELECT ON users.permission_flags, users.roles, users.permission_overwrites TO aether_user_authz_reader;

RESET ROLE;
