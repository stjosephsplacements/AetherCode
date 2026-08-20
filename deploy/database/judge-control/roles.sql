\set ON_ERROR_STOP on

\if :{?judge_db_name}
\else
\echo 'Set judge_db_name to the logical Judge control-plane database name.'
\quit
\endif

SELECT :'judge_db_name' ~ '^[a-z][a-z0-9_]{0,62}$' AS judge_db_name_valid \gset
\if :judge_db_name_valid
\else
\echo 'judge_db_name must be a lowercase PostgreSQL identifier.'
\quit
\endif

DO $bootstrap$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aether_judge_migrator') THEN
        CREATE ROLE aether_judge_migrator
            NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aether_judge_app') THEN
        CREATE ROLE aether_judge_app
            NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    END IF;
END
$bootstrap$;

SELECT format(
    'CREATE DATABASE %I WITH OWNER aether_judge_migrator ENCODING ''UTF8'' TEMPLATE template0',
    :'judge_db_name'
)
WHERE NOT EXISTS (
    SELECT 1 FROM pg_database WHERE datname = :'judge_db_name'
) \gexec

SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'judge_db_name') \gexec
SELECT format('REVOKE CREATE ON DATABASE %I FROM PUBLIC', :'judge_db_name') \gexec
SELECT format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO aether_judge_migrator', :'judge_db_name') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO aether_judge_app', :'judge_db_name') \gexec

-- Login identities are created by the PostgreSQL mTLS/identity provisioning
-- layer and granted one of these group roles. This script deliberately never
-- creates password-bearing or LOGIN roles.
