-- The retention worker has its own execute-only login and must reconnect
-- without inheriting any table-owner privilege.
SET ROLE aether_notification_owner;

DO $connect$
DECLARE
    target_role text;
BEGIN
    FOREACH target_role IN ARRAY ARRAY[
        'aether_notification_migrator',
        'aether_notification_app',
        'aether_notification_authz_reader',
        'aether_notification_projection_worker',
        'aether_notification_retention_worker'
    ] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = target_role) THEN
            RAISE EXCEPTION 'required role % is missing', target_role;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = target_role AND (rolsuper OR rolbypassrls)) THEN
            RAISE EXCEPTION 'role % must not be superuser or BYPASSRLS', target_role;
        END IF;
        EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), target_role);
    END LOOP;
    EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
END
$connect$;

RESET ROLE;
