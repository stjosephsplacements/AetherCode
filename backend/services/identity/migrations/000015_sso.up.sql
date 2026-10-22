-- Single sign-on through the college's identity provider (ADR-0042).
-- sso_links ties an AetherCode principal to the provider's user (its OIDC
-- subject and directory user ID). sso_directory_sync lists accounts whose
-- username, name or password hash must be copied to the provider; triggers
-- fill it, so every way an account or password is created or changed is
-- covered, and only hashes ever leave this database.
SET ROLE aether_identity_owner;

CREATE TABLE identity.sso_links (
    principal_id uuid PRIMARY KEY REFERENCES identity.principals (id) ON DELETE CASCADE,
    directory_user_id text UNIQUE CHECK (char_length(directory_user_id) BETWEEN 1 AND 200),
    subject text UNIQUE CHECK (char_length(subject) BETWEEN 1 AND 255),
    -- Whether AetherCode created the provider's account. Only then does it
    -- keep the provider's password in step with its own.
    created_by_aethercode boolean NOT NULL DEFAULT false,
    linked_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE identity.sso_directory_sync (
    principal_id uuid PRIMARY KEY REFERENCES identity.principals (id) ON DELETE CASCADE,
    requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    last_error text CHECK (char_length(last_error) <= 1000)
);
CREATE INDEX sso_directory_sync_due_idx ON identity.sso_directory_sync (next_attempt_at);

CREATE FUNCTION identity.request_sso_directory_sync()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, identity
AS $function$
DECLARE
    target uuid;
BEGIN
    -- Separate branches: PL/pgSQL compiles a statement against the row type
    -- only when it runs, so each table reads only its own column.
    IF TG_TABLE_NAME = 'principals' THEN
        target := NEW.id;
    ELSE
        target := NEW.principal_id;
    END IF;
    INSERT INTO identity.sso_directory_sync (principal_id)
    VALUES (target)
    ON CONFLICT (principal_id) DO UPDATE
    SET requested_at = clock_timestamp(), attempts = 0, next_attempt_at = clock_timestamp(), last_error = NULL;
    RETURN NEW;
END
$function$;

CREATE TRIGGER password_credentials_sso_sync
    AFTER INSERT OR UPDATE OF password_hash ON identity.password_credentials
    FOR EACH ROW EXECUTE FUNCTION identity.request_sso_directory_sync();
CREATE TRIGGER principals_sso_sync
    AFTER UPDATE OF username, display_name, email ON identity.principals
    FOR EACH ROW
    WHEN (NEW.deleted_at IS NULL AND (OLD.username, OLD.display_name, OLD.email) IS DISTINCT FROM (NEW.username, NEW.display_name, NEW.email))
    EXECUTE FUNCTION identity.request_sso_directory_sync();

-- Every existing account with a password is copied once.
INSERT INTO identity.sso_directory_sync (principal_id)
SELECT credential.principal_id
FROM identity.password_credentials AS credential
JOIN identity.principals AS principal ON principal.id = credential.principal_id
WHERE principal.deleted_at IS NULL
ON CONFLICT DO NOTHING;

GRANT SELECT, INSERT, UPDATE ON identity.sso_links TO aether_identity_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON identity.sso_directory_sync TO aether_identity_app;

RESET ROLE;
