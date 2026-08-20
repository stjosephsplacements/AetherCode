-- The completion bridge has a separate execute-only login. Grant it database
-- admission directly, never through membership in the table-owning role.
SET ROLE aether_submission_owner;

DO $connect$
DECLARE
    target_role text;
BEGIN
    FOREACH target_role IN ARRAY ARRAY[
        'aether_submission_migrator',
        'aether_submission_app',
        'aether_submission_authz_reader',
        'aether_submission_projection_worker',
        'aether_submission_judge_adapter'
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
