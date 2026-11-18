#!/bin/sh
# Applies every platform service's migrations with that service's dedicated
# migrator login (never the superuser), in dependency-free order.
set -eu
: "${PGHOST:?PGHOST is required}"
run() {
  service="$1"; database="$2"; role="$3"; password_variable="$4"
  eval "password=\${$password_variable:?$password_variable is required}"
  echo "migrating ${service} (${database}) as ${role}"
  migrate --database-url "postgres://${role}:${password}@${PGHOST}:5432/${database}?sslmode=disable" \
    --source "file:///migrations/${service}" --direction up
}
run identity      aether_identity     aether_identity_migrator      IDENTITY_DB_PASSWORD
run tenant        aether_tenant       aether_tenant_migrator        TENANT_DB_PASSWORD
run user          aether_users        aether_user_migrator          USERS_DB_PASSWORD
run question-bank aether_qbank        aether_question_bank_migrator QBANK_DB_PASSWORD
run assessment    aether_assessment   aether_assessment_migrator    ASSESSMENT_DB_PASSWORD
run submission    aether_submission   aether_submission_migrator    SUBMISSION_DB_PASSWORD
run seb           aether_seb          aether_seb_migrator           SEB_DB_PASSWORD
run notification  aether_notification aether_notification_migrator  NOTIFICATION_DB_PASSWORD
run analytics     aether_analytics    aether_analytics_migrator     ANALYTICS_DB_PASSWORD
# proctor arrived after the first release: an install made before it has no password or database for it
# (see "Upgrades" in README.md), so it is skipped with a message instead of failing the whole job.
if [ -n "${PROCTOR_DB_PASSWORD:-}" ]; then
  run proctor     aether_proctor      aether_proctor_migrator       PROCTOR_DB_PASSWORD
else
  echo "skipping proctor: PROCTOR_DB_PASSWORD is not set; follow the proctor step in deploy/single-server/README.md (Upgrades)"
fi
echo "all platform migrations applied"
