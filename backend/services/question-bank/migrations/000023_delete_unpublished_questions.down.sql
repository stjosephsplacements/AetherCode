SET ROLE aether_question_bank_owner;

DROP FUNCTION qbank.soft_delete_question_version(uuid, text);
DROP FUNCTION qbank.soft_delete_question(uuid, text);

RESET ROLE;
