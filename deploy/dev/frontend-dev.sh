#!/usr/bin/env bash
# Runs the web UI on this machine against a gateway on the dev server (live development).
#   deploy/dev/frontend-dev.sh [namespace] [public origin]
# namespace: aethercode (the dev backend, default) or aether-test (the isolated copy used for tests).
# It opens an SSH tunnel to the namespace's gateway on 127.0.0.1:18080, then starts `pnpm dev` on
# http://localhost:3000. The server's key must be loaded in your agent. The `stjosephs` ssh alias goes
# through Cloudflare and times out, so this uses the address directly.
set -euo pipefail
namespace="${1:-aethercode}"
origin="${2:-http://localhost:3000}"
host="aethercode@115.247.189.246"
ssh_options=(-o ProxyCommand=none -o BatchMode=yes)

gateway_ip="$(ssh "${ssh_options[@]}" "$host" "kubectl -n $namespace get svc gateway -o jsonpath='{.spec.clusterIP}'")"
if ! (exec 3<>/dev/tcp/127.0.0.1/18080) 2>/dev/null; then
  ssh "${ssh_options[@]}" -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -N -f -L "127.0.0.1:18080:${gateway_ip}:8080" "$host"
fi

cd "$(dirname "$0")/../../frontend"
export GATEWAY_URL="http://127.0.0.1:18080"
export PUBLIC_ORIGIN="$origin"
export DEV_ORIGINS="http://localhost:3000,http://127.0.0.1:3000"
exec pnpm dev
