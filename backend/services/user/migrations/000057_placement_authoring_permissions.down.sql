SET ROLE aether_user_owner;

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
