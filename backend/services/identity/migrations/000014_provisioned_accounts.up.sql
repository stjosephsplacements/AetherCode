-- Administrators provision student and staff accounts (ADR-0019). Such an
-- account signs in with a username (a student's roll number) and need not
-- have an email address, so email becomes optional while every principal
-- keeps at least one sign-in identifier. Usernames are stored lowercase.
SET ROLE aether_identity_owner;

ALTER TABLE identity.principals
    ADD COLUMN username text CHECK (username ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
    ALTER COLUMN email DROP NOT NULL,
    ADD CONSTRAINT principals_sign_in_identifier_check CHECK (email IS NOT NULL OR username IS NOT NULL);

CREATE UNIQUE INDEX principals_active_username_unique
    ON identity.principals (username)
    WHERE deleted_at IS NULL AND username IS NOT NULL;

RESET ROLE;
