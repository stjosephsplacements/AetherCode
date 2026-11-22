#!/usr/bin/env bash
# Local UI against the in-repo gateway emulator (no campus SSH).
set -euo pipefail
cd "$(dirname "$0")/.."
export GATEWAY_URL="${GATEWAY_URL:-http://127.0.0.1:8380}"
export PUBLIC_ORIGIN="${PUBLIC_ORIGIN:-http://localhost:3000}"
export DEV_ORIGINS="${DEV_ORIGINS:-http://localhost:3000,http://127.0.0.1:3000}"
export DEV_GATEWAY_PORT="${DEV_GATEWAY_PORT:-8380}"

if ! (exec 3<>"/dev/tcp/127.0.0.1/${DEV_GATEWAY_PORT}") 2>/dev/null; then
  node scripts/dev-gateway.mjs &
  gateway_pid=$!
  trap 'kill "$gateway_pid" 2>/dev/null || true' EXIT
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if curl -sf "http://127.0.0.1:${DEV_GATEWAY_PORT}/readyz" >/dev/null; then break; fi
    sleep 0.2
  done
fi

exec pnpm dev
