SET ROLE aether_identity_owner;

DROP TRIGGER principals_sso_sync ON identity.principals;
DROP TRIGGER password_credentials_sso_sync ON identity.password_credentials;
DROP FUNCTION identity.request_sso_directory_sync();
DROP TABLE identity.sso_directory_sync;
DROP TABLE identity.sso_links;

RESET ROLE;
