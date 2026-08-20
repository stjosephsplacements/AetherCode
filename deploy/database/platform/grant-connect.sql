\set ON_ERROR_STOP on

-- Run only through the approved platform database-administrator identity.
-- This is the recovery/bootstrap companion to the per-service expansion
-- migrations: it restores direct CONNECT grants if an older deployment has
-- already revoked PUBLIC before those migrations were installed.
DO $connect$
DECLARE
    database_name text;
    target_roles text[];
    target_role text;
BEGIN
    FOR database_name, target_roles IN
        SELECT *
        FROM (
            VALUES
                ('aether_identity'::text, ARRAY[
                    'aether_identity_migrator', 'aether_identity_app',
                    'aether_identity_authz_reader', 'aether_identity_projection_worker'
                ]::text[]),
                ('aether_tenant'::text, ARRAY[
                    'aether_tenant_migrator', 'aether_tenant_app',
                    'aether_tenant_authz_reader', 'aether_tenant_projection_worker'
                ]::text[]),
                ('aether_users'::text, ARRAY[
                    'aether_user_migrator', 'aether_user_app',
                    'aether_user_authz_reader', 'aether_user_projection_worker'
                ]::text[]),
                ('aether_qbank'::text, ARRAY[
                    'aether_question_bank_migrator', 'aether_question_bank_app',
                    'aether_question_bank_authz_reader', 'aether_question_bank_projection_worker'
                ]::text[]),
                ('aether_assessment'::text, ARRAY[
                    'aether_assessment_migrator', 'aether_assessment_app',
                    'aether_assessment_authz_reader', 'aether_assessment_projection_worker'
                ]::text[]),
                ('aether_submission'::text, ARRAY[
                    'aether_submission_migrator', 'aether_submission_app',
                    'aether_submission_authz_reader', 'aether_submission_projection_worker',
                    'aether_submission_judge_adapter'
                ]::text[]),
                ('aether_seb'::text, ARRAY[
                    'aether_seb_migrator', 'aether_seb_app',
                    'aether_seb_authz_reader', 'aether_seb_projection_worker'
                ]::text[]),
                ('aether_notification'::text, ARRAY[
                    'aether_notification_migrator', 'aether_notification_app',
                    'aether_notification_authz_reader', 'aether_notification_projection_worker',
                    'aether_notification_retention_worker'
                ]::text[]),
                ('aether_analytics'::text, ARRAY[
                    'aether_analytics_migrator', 'aether_analytics_app',
                    'aether_analytics_authz_reader', 'aether_analytics_projection_worker'
                ]::text[])
        ) AS required(database_name, target_roles)
    LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = database_name) THEN
            RAISE EXCEPTION 'required database % is missing', database_name;
        END IF;
        EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', database_name);
        FOREACH target_role IN ARRAY target_roles LOOP
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = target_role) THEN
                RAISE EXCEPTION 'required role % is missing', target_role;
            END IF;
            IF EXISTS (
                SELECT 1 FROM pg_roles
                WHERE rolname = target_role AND (rolsuper OR rolbypassrls)
            ) THEN
                RAISE EXCEPTION 'role % must not be superuser or BYPASSRLS', target_role;
            END IF;
            EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', database_name, target_role);
        END LOOP;
    END LOOP;
END
$connect$;

SELECT datname,
       EXISTS (
           SELECT 1
           FROM aclexplode(COALESCE(pg_database.datacl, acldefault('d', pg_database.datdba))) AS privilege
           WHERE privilege.grantee = 0
             AND privilege.privilege_type = 'CONNECT'
       ) AS public_can_connect
FROM pg_database
WHERE datname IN (
    'aether_identity', 'aether_tenant', 'aether_users', 'aether_qbank',
    'aether_assessment', 'aether_submission', 'aether_seb',
    'aether_notification', 'aether_analytics'
)
ORDER BY datname;
