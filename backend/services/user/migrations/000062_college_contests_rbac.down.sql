SET ROLE aether_user_owner;
UPDATE users.roles
SET permissions = permissions & ~users.flag_bits(ARRAY['question-bank.college_contests.read', 'question-bank.college_contests.write'])
WHERE name IN ('college_admin', 'department_user', 'mentor', 'student');
-- Permission flags are append-only; the three flags stay.

RESET ROLE;