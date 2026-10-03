SET ROLE aether_identity_owner;

DROP TRIGGER IF EXISTS cascade_principal_soft_delete_trigger ON identity.principals;
DROP FUNCTION IF EXISTS identity.cascade_principal_soft_delete();

RESET ROLE;
