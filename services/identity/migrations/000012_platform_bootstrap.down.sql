SET ROLE aether_identity_owner;

DROP FUNCTION IF EXISTS identity.bootstrap_first_principal(uuid, text, text);

RESET ROLE;
