SET ROLE aether_user_owner;
UPDATE users.roles
SET permissions = permissions & ~users.flag_bits(ARRAY['question-bank.college_contests.read', 'question-bank.college_contests.write'])
WHERE name IN ('college_admin', 'department_user', 'mentor', 'student');
DELETE FROM users.permission_flags
WHERE key IN ('question-bank.college_contests.read', 'question-bank.college_contests.write', 'question-bank.college_contests.delete');
RESET ROLE;