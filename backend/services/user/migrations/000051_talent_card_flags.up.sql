-- Talent cards (ADR-0081). Issuing a card exposes a student's results to a recruiter, so
-- analytics.talent_cards is opened by VIEW_STUDENT_PII (see permsAllow) and registered
-- platform-only. A student manages their own consent: analytics.talent_card_consents joins
-- the Student role, for existing colleges and for those created later.
SET ROLE aether_user_owner;

INSERT INTO users.permission_flags (key, bit_index, kind, elevated, platform_only) VALUES
    ('analytics.talent_cards.read', 208, 'resource', false, true),
    ('analytics.talent_cards.write', 209, 'resource', false, true),
    ('analytics.talent_cards.delete', 210, 'resource', false, true),
    ('analytics.talent_card_consents.read', 211, 'resource', false, false),
    ('analytics.talent_card_consents.write', 212, 'resource', false, false),
    ('analytics.talent_card_consents.delete', 213, 'resource', false, false)
ON CONFLICT DO NOTHING;

-- Managed roles reject changes unless the migration opts in (000039), as 000050 does.
SET LOCAL users.allow_managed_change = 'on';
UPDATE users.roles
SET permissions = permissions | users.flag_bits(ARRAY['analytics.talent_card_consents.read', 'analytics.talent_card_consents.write'])
WHERE managed AND system_key = 'student';

CREATE OR REPLACE FUNCTION users.ensure_guild_roles(p_guild text, p_tenant uuid)
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
                                   'seb.sessions.read', 'seb.validation_events.read', 'seb.validation_events.write',
                                   'analytics.talent_card_consents.read', 'analytics.talent_card_consents.write']),
             true, 'student'),
            ('college', p_tenant, 1, '@everyone', 0, everyone, true, 'everyone')
        ON CONFLICT DO NOTHING;
    END IF;
END
$function$;

RESET ROLE;
