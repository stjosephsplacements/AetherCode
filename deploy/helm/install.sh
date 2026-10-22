#!/usr/bin/env bash
# Installs (or upgrades) the whole AetherCode platform into one namespace, in order:
# PKI, backing services, migrations, then the twelve workloads.
# Usage: ./install.sh <namespace> <public origin> <ingress host> <image tag> [extra helm args]
#   ./install.sh aethercode https://exam.example.edu exam.example.edu 0.2.0 --set ingress.className=nginx
# The aethercode-secrets Secret must already exist (see generate-secrets.sh).
set -euo pipefail
cd "$(dirname "$0")"
namespace="${1:-}"; origin="${2:-}"; host="${3:-}"; tag="${4:-}"
if [[ -z "$namespace" || -z "$origin" || -z "$host" || -z "$tag" ]]; then
  sed -n 2,6p "$0" | sed 's/^# \{0,1\}//' >&2
  exit 1
fi
shift 4

kubectl get secret aethercode-secrets -n "$namespace" >/dev/null ||
  { echo "Secret aethercode-secrets not found in $namespace; run generate-secrets.sh first" >&2; exit 1; }

helm upgrade --install pki platform-pki -n "$namespace" --wait
helm upgrade --install infra platform-infra -n "$namespace" --wait --timeout 10m
helm upgrade --install migrations platform-migrations -n "$namespace" --set image.tag="$tag" --wait --timeout 15m

for svc in gateway identity tenant user question-bank assessment submission judge seb notification analytics frontend; do
  extra=()
  [[ "$svc" == frontend ]] && extra=(--set "ingress.host=$host" "$@")
  helm upgrade --install "$svc" platform-service -n "$namespace" \
    -f values-common.yaml --set global.publicOrigin="$origin" \
    -f "platform-service/values-$svc.yaml" --set image.tag="$tag" "${extra[@]}" --wait --timeout 10m
done
