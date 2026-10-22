SET ROLE aether_question_bank_owner;
DROP FUNCTION qbank.export_question_version(uuid, uuid);
DROP TABLE qbank.question_export_events;
RESET ROLE;
