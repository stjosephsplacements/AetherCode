-- A phone number for an account (ADR-0057). Optional personal data, shown only to staff
-- who can already read the account summary. Digits, spaces, plus, dash and brackets.
SET ROLE aether_identity_owner;

ALTER TABLE identity.principals
    ADD COLUMN phone text CHECK (phone ~ '^[0-9 +()-]{6,20}$');

RESET ROLE;
