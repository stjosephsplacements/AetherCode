SET ROLE aether_question_bank_owner;
DROP FUNCTION IF EXISTS qbank.college_contest_leaderboard(uuid, uuid);
DROP FUNCTION IF EXISTS qbank.register_college_contest(uuid, uuid);
DROP FUNCTION IF EXISTS qbank.save_college_contest(uuid, uuid, text, text, timestamptz, timestamptz, uuid[]);
DROP FUNCTION IF EXISTS qbank.list_college_contests(uuid);
DROP FUNCTION IF EXISTS qbank.contest_lifecycle(timestamptz, timestamptz);
DROP TABLE IF EXISTS qbank.college_contest_registrations;
DROP TABLE IF EXISTS qbank.college_contests;
RESET ROLE;