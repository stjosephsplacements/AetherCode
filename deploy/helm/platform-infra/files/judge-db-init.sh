#!/usr/bin/env bash
# Judge control-plane database roles for the single-server stack: the shared
# role definitions, login passwords for the migrator and application, and a
# non-login database owner the migrator can assume (the migrate tool refuses a
# login owner).
set -euo pipefail
psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -f /docker-entrypoint-initdb.d/judge-roles.sql.in
psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=password="$JUDGE_DB_PASSWORD" <<'SQL'
ALTER ROLE aether_judge_migrator LOGIN PASSWORD :'password';
ALTER ROLE aether_judge_app LOGIN PASSWORD :'password';
CREATE ROLE aether_judge_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT aether_judge_owner TO aether_judge_migrator;
ALTER DATABASE aether_judge_wrapper OWNER TO aether_judge_owner;
SQL
