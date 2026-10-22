SET ROLE aether_question_bank_owner;
REVOKE USAGE ON SCHEMA qbank FROM aether_question_bank_projection_worker;
DROP FUNCTION qbank.finish_model_check(uuid, text, text, jsonb);
DROP FUNCTION qbank.list_model_checks(uuid);
DROP FUNCTION qbank.start_model_check(uuid, uuid, text, text, text, text);
DROP TABLE qbank.model_checks;
RESET ROLE;
