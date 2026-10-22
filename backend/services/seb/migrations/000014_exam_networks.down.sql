SET ROLE aether_seb_owner;

DROP FUNCTION seb.check_exam_request(uuid, text, text, text, inet);
ALTER TABLE seb.exam_policies DROP COLUMN allowed_networks;

RESET ROLE;
