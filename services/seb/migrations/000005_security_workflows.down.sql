SET ROLE aether_seb_owner;

REVOKE EXECUTE ON FUNCTION seb.rotate_configuration(
    uuid, uuid, uuid, uuid, uuid, uuid, uuid, integer, text, char(64),
    char(64), text, char(64), text, uuid
) FROM aether_seb_app;
REVOKE EXECUTE ON FUNCTION seb.revoke_configuration(uuid, uuid, uuid, text, uuid) FROM aether_seb_app;
REVOKE EXECUTE ON FUNCTION seb.issue_session(uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, char(64)) FROM aether_seb_app;
REVOKE EXECUTE ON FUNCTION seb.validate_session_header(uuid, uuid, uuid, text, boolean, char(64), char(64)) FROM aether_seb_app;
DROP FUNCTION seb.validate_session_header(uuid, uuid, uuid, text, boolean, char(64), char(64));
DROP FUNCTION seb.issue_session(uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, char(64));
DROP FUNCTION seb.revoke_configuration(uuid, uuid, uuid, text, uuid);
DROP FUNCTION seb.rotate_configuration(
    uuid, uuid, uuid, uuid, uuid, uuid, uuid, integer, text, char(64),
    char(64), text, char(64), text, uuid
);

RESET ROLE;
