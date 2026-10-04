SET ROLE aether_identity_owner;

DO $block$
BEGIN
    IF EXISTS (SELECT 1 FROM identity.principals WHERE email IS NULL) THEN
        RAISE EXCEPTION 'principals without an email address exist; remove them before reverting 000014';
    END IF;
END
$block$;

DROP INDEX identity.principals_active_username_unique;
ALTER TABLE identity.principals
    DROP CONSTRAINT principals_sign_in_identifier_check,
    ALTER COLUMN email SET NOT NULL,
    DROP COLUMN username;

RESET ROLE;
