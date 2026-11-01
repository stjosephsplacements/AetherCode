#!/usr/bin/env bash
# Lints and renders every chart, and checks the scripts copied into charts against their originals.
set -euo pipefail
cd "$(dirname "$0")"
secrets=(--set image.tag=ci)

helm lint platform-pki platform-infra
helm lint platform-migrations "${secrets[@]}"
helm template pki platform-pki >/dev/null
helm template infra platform-infra >/dev/null
helm template migrations platform-migrations "${secrets[@]}" >/dev/null

# The migration hooks must follow values-common.yaml's database hosts.
migrations=$(helm template migrations platform-migrations -f values-common.yaml \
  --set global.postgresHost=pg.example.edu --set global.judgeDbHost=judge-pg.example.edu --set image.tag=ci)
grep -q 'value: "pg.example.edu"' <<<"$migrations"
grep -qF '@judge-pg.example.edu:5432' <<<"$migrations"
grep -q 'value: "judge-pg.example.edu"' <<<"$migrations"

for values in platform-service/values-*.yaml; do
  svc="${values#platform-service/values-}"; svc="${svc%.yaml}"
  extra=()
  [[ "$svc" == frontend ]] && extra=(--set ingress.host=exam.example.edu)
  helm lint platform-service -f values-common.yaml --set global.publicOrigin=https://exam.example.edu \
    -f "$values" --set image.tag=ci "${extra[@]}"
  helm template "$svc" platform-service -f values-common.yaml --set global.publicOrigin=https://exam.example.edu \
    -f "$values" --set image.tag=ci "${extra[@]}" >/dev/null
done

# Helm cannot read outside a chart, so these are copies; they must not drift.
diff -u ../database/platform/dev-init.sh platform-infra/files/platform-dev-init.sh
diff -u ../single-server/judge-db-init.sh platform-infra/files/judge-db-init.sh
diff -u ../database/judge-control/init/001-local-roles.sql platform-infra/files/judge-roles.sql.in
diff -u ../single-server/judge-languages.sh platform-migrations/files/judge-languages.sh
echo "helm charts OK"
