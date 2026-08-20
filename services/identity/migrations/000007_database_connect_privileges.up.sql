-- The bootstrap migration revokes PUBLIC database access. Keep every approved
-- non-owner service identity directly reconnectable without making it a member
-- of the owner role.
SET ROLE aether_identity_owner;

DO $connect$
DECLARE
    target_role text;
BEGIN
    FOREACH target_role IN ARRAY ARRAY[
        'aether_identity_migrator',
        'aether_identity_app',
        'aether_identity_authz_reader',
        'aether_identity_projection_worker'
    ] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = target_role) THEN
            RAISE EXCEPTION 'required role % is missing', target_role;
        END IF;
        IF EXISTS (
            SELECT 1 FROM pg_roles
            WHERE rolname = target_role AND (rolsuper OR rolbypassrls)
        ) THEN
            RAISE EXCEPTION 'role % must not be superuser or BYPASSRLS', target_role;
        END IF;
        EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), target_role);
    END LOOP;
    EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
END
$connect$;

RESET ROLE;
