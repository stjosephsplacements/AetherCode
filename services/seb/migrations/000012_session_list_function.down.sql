SET ROLE aether_seb_owner;

DROP FUNCTION IF EXISTS seb.list_sessions(uuid, integer, timestamptz, uuid, text);
DROP INDEX IF EXISTS seb.sessions_candidate_keyset_idx;

RESET ROLE;
