#!/usr/bin/env bash
set -euo pipefail

# Docker executes init scripts as the postgres operating-system user, not as
# POSTGRES_USER. Point libpq utilities at the bootstrap superuser/database so
# local provisioning works when the cluster administrator has a custom name.
export PGUSER="${PGUSER:-${POSTGRES_USER:?POSTGRES_USER is required}}"
export PGDATABASE="${PGDATABASE:-${POSTGRES_DB:-postgres}}"

readonly -a DATABASES=(
  'identity:aether_identity:IDENTITY_DB_PASSWORD:identity'
  'tenant:aether_tenant:TENANT_DB_PASSWORD:tenant'
  'users:aether_users:USERS_DB_PASSWORD:user'
  'qbank:aether_qbank:QBANK_DB_PASSWORD:question_bank'
  'assessment:aether_assessment:ASSESSMENT_DB_PASSWORD:assessment'
  'submission:aether_submission:SUBMISSION_DB_PASSWORD:submission'
  'seb:aether_seb:SEB_DB_PASSWORD:seb'
  'notification:aether_notification:NOTIFICATION_DB_PASSWORD:notification'
  'analytics:aether_analytics:ANALYTICS_DB_PASSWORD:analytics'
)

create_group_role_if_missing() {
  local role="$1"
  psql --set=ON_ERROR_STOP=1 --set=role="$role" <<'SQL'
SELECT format('CREATE ROLE %I NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', :'role')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'role')
\gexec
SQL
}

create_login_role_if_missing() {
  local role="$1"
  local password="$2"
  psql --set=ON_ERROR_STOP=1 --set=role="$role" --set=password="$password" <<'SQL'
SELECT format(
    'CREATE ROLE %I LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
    :'role',
    :'password'
)
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'role')
\gexec
SQL
}

for entry in "${DATABASES[@]}"; do
  IFS=':' read -r service database password_variable role_prefix <<<"$entry"
  password="${!password_variable:?missing ${password_variable}}"
  owner="aether_${role_prefix}_owner"
  migrator="aether_${role_prefix}_migrator"
  application="aether_${role_prefix}_app"
  projection_worker="aether_${role_prefix}_projection_worker"
  authz_reader="aether_${role_prefix}_authz_reader"

  create_group_role_if_missing "$owner"
  create_login_role_if_missing "$projection_worker" "$password"
  create_login_role_if_missing "$migrator" "$password"
  create_login_role_if_missing "$application" "$password"
  create_login_role_if_missing "$authz_reader" "$password"

  psql --set=ON_ERROR_STOP=1 --set=owner="$owner" --set=migrator="$migrator" <<'SQL'
GRANT :"owner" TO :"migrator";
SQL

  if ! psql --tuples-only --no-align --command "SELECT 1 FROM pg_database WHERE datname = '${database}'" | grep -qx '1'; then
    createdb --owner="$owner" "$database"
  fi

  psql --set=ON_ERROR_STOP=1 --dbname="$database" \
    --set=database="$database" --set=owner="$owner" --set=migrator="$migrator" \
    --set=application="$application" \
    --set=projection_worker="$projection_worker" \
    --set=authz_reader="$authz_reader" <<'SQL'
REVOKE ALL ON DATABASE :"database" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"database" TO :"migrator", :"application", :"projection_worker", :"authz_reader";
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO :"migrator";
SQL
done

# The completion bridge is a separate login so a leaked adapter credential
# cannot serve candidate traffic or consume projection messages. It shares the
# local development password only because this bootstrap is not production
# credential provisioning; production mounts a distinct client certificate.
create_login_role_if_missing "aether_submission_judge_adapter" "${SUBMISSION_DB_PASSWORD:?missing SUBMISSION_DB_PASSWORD}"
psql --set=ON_ERROR_STOP=1 --dbname="aether_submission" \
  --set=database="aether_submission" --set=adapter="aether_submission_judge_adapter" <<'SQL'
GRANT CONNECT ON DATABASE :"database" TO :"adapter";
SQL

# Retention has an intentionally separate login: it can execute one bounded
# owner-defined purge routine but cannot serve request traffic, consume events,
# or read/write Notification tables directly.
create_login_role_if_missing "aether_notification_retention_worker" "${NOTIFICATION_DB_PASSWORD:?missing NOTIFICATION_DB_PASSWORD}"
psql --set=ON_ERROR_STOP=1 --dbname="aether_notification" \
  --set=database="aether_notification" --set=retention_worker="aether_notification_retention_worker" <<'SQL'
GRANT CONNECT ON DATABASE :"database" TO :"retention_worker";
SQL

# Expiry has an intentionally separate login: it can execute one bounded
# owner-defined expiry routine but cannot serve request traffic, consume events,
# or read/write Submission tables directly.
create_login_role_if_missing "aether_submission_expiry_worker" "${SUBMISSION_DB_PASSWORD:?missing SUBMISSION_DB_PASSWORD}"
psql --set=ON_ERROR_STOP=1 --dbname="aether_submission" \
  --set=database="aether_submission" --set=expiry_worker="aether_submission_expiry_worker" <<'SQL'
GRANT CONNECT ON DATABASE :"database" TO :"expiry_worker";
SQL
