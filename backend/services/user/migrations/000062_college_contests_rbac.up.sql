SET ROLE aether_user_owner;

INSERT INTO users.permission_flags (key, bit_index, kind, platform_only, student_managed)
VALUES
    ('question-bank.college_contests.read', 223, 'resource', false, false),
    ('question-bank.college_contests.write', 224, 'resource', false, false),
    ('question-bank.college_contests.delete', 225, 'resource', false, false)
ON CONFLICT (key) DO NOTHING;

UPDATE users.roles
SET permissions = permissions | users.flag_bits(ARRAY['question-bank.college_contests.read', 'question-bank.college_contests.write'])
WHERE name IN ('college_admin', 'department_user', 'mentor', 'student');

RESET ROLE;