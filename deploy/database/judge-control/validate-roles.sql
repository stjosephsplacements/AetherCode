\set ON_ERROR_STOP on

\if :{?judge_db_name}
\else
\echo 'Set judge_db_name to the logical Judge control-plane database name.'
\quit
\endif

SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
FROM pg_roles
WHERE rolname IN ('aether_judge_migrator', 'aether_judge_app')
ORDER BY rolname;

SELECT datname, datdba::regrole AS owner
FROM pg_database
WHERE datname = :'judge_db_name';

SELECT has_database_privilege('PUBLIC', :'judge_db_name', 'CREATE') AS public_can_create,
       has_database_privilege('PUBLIC', :'judge_db_name', 'CONNECT') AS public_can_connect,
       has_database_privilege('aether_judge_app', :'judge_db_name', 'CONNECT') AS app_can_connect,
       has_database_privilege('aether_judge_migrator', :'judge_db_name', 'CONNECT') AS migrator_can_connect;
