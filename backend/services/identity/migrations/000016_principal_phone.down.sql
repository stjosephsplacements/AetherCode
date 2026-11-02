SET ROLE aether_identity_owner;

ALTER TABLE identity.principals DROP COLUMN phone;

RESET ROLE;
