SET ROLE aether_seb_owner;

DROP FUNCTION IF EXISTS seb.close_sessions_for_candidate(uuid, uuid, uuid, text);
DROP FUNCTION IF EXISTS seb.close_sessions_for_attempt(uuid, uuid, uuid, text);
DROP TABLE IF EXISTS seb.projection_inbox_messages;

RESET ROLE;
