-- Placement officers author questions, placement-targeted exams, and blogs (ADR-0089).
SET ROLE aether_user_owner;

SET LOCAL users.allow_managed_change = 'on';
UPDATE users.roles
SET permissions = users.flag_bits(ARRAY[
    'VIEW_SCOPE', 'VIEW_PLACEMENT_POOL', 'VIEW_STUDENT_PII', 'VIEW_GOLD_ANALYTICS', 'MANAGE_PLACEMENT',
    'user.students.read', 'user.students.write',
    'user.student_department_memberships.read', 'user.student_department_memberships.write',
    'user.student_batch_affiliations.read', 'user.student_batch_affiliations.write',
    'question-bank.questions.read', 'question-bank.questions.write',
    'question-bank.question_versions.read', 'question-bank.question_versions.write',
    'question-bank.test_case_manifests.read', 'question-bank.test_case_manifests.write',
    'question-bank.tags.read', 'question-bank.tags.write',
    'question-bank.question_version_tags.read', 'question-bank.question_version_tags.write',
    'question-bank.categories.read',
    'assessment.exams.read', 'assessment.exams.write',
    'assessment.exam_versions.read', 'assessment.exam_versions.write',
    'assessment.exam_sections.read', 'assessment.exam_sections.write',
    'assessment.exam_items.read', 'assessment.exam_items.write',
    'assessment.assignment_rules.read', 'assessment.assignment_rules.write',
    'assessment.candidate_assignments.read', 'assessment.candidate_assignments.write',
    'assessment.proctor_policies.read', 'assessment.proctor_policies.write',
    'assessment.proctor_policy_versions.read', 'assessment.proctor_policy_versions.write',
    'notification.community.read', 'notification.community.write',
    'notification.community_moderation.read', 'notification.community_moderation.write'
]),
    updated_at = clock_timestamp()
WHERE system_key = 'placement_officer' AND managed;

RESET ROLE;
