#!/usr/bin/env bash
set -euo pipefail

chart_root="${1:-deploy/helm/charts/judge0-engine}"

if rg -n --glob '*.yaml' --glob '*.tpl' --glob '*.yml' \
  'privileged:\s*true|hostNetwork:\s*true|hostPID:\s*true|hostIPC:\s*true|hostPath:|docker\.sock' \
  "$chart_root"; then
  printf '%s\n' 'Judge0 chart contains a prohibited execution-isolation setting.' >&2
  exit 1
fi

if ! rg -q 'runtimeClassName: \{\{ \.Values\.runtimeClassName \}\}' "$chart_root/templates/engine.yaml"; then
  printf '%s\n' 'Judge0 chart must bind Pods to the configured gVisor RuntimeClass.' >&2
  exit 1
fi

if ! rg -q 'ALLOW_ENABLE_NETWORK: "false"' "$chart_root/templates/engine.yaml" || \
   ! rg -q 'ENABLE_NETWORK: "false"' "$chart_root/templates/engine.yaml" || \
   ! rg -q 'ENABLE_CALLBACKS: "false"' "$chart_root/templates/engine.yaml"; then
  printf '%s\n' 'Judge0 chart must disable network and callbacks.' >&2
  exit 1
fi

printf '%s\n' 'Judge0 chart static isolation checks passed.'
