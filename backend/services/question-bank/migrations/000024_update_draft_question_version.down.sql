SET ROLE aether_question_bank_owner;

DROP FUNCTION qbank.update_question_version(uuid, bigint, text, text, text, integer, integer);

RESET ROLE;
