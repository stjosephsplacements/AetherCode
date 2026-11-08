#!/usr/bin/env bash
# Live-dev deploy: dev-sync.sh <sha> [service ...]
#
# Two modes:
#   CI mode (default):  images were already built and pushed to GHCR by CI.
#                       Just pulls and does helm upgrade — typically < 2 min.
#   Local mode (--build): builds on the server from /tmp/aether-dev-src.tgz.
#                         Use only when CI is not available or for hotfixes.
#
# Usage:
#   dev-sync.sh <sha> [service ...]           # pull pre-built images from GHCR
#   dev-sync.sh --build <sha> [service ...]   # build on server (slow)
set -euo pipefail

BUILD=false
if [[ "${1:-}" == "--build" ]]; then BUILD=true; shift; fi
SHA=$1; shift; SVCS=("$@")
REG=ghcr.io/stjosephsplacements
TAG=$SHA   # CI tags images with the commit SHA directly

if $BUILD; then
  # ── Local build (slow path) ────────────────────────────────────────────────
  rm -rf ~/aether-dev && mkdir -p ~/aether-dev
  tar -xzf /tmp/aether-dev-src.tgz -C ~/aether-dev
  chmod -R o+rX ~/aether-dev
  cd ~/aether-dev

  build() { # name context dockerfile
    local img="$REG/aethercode-$1:$TAG"
    buildah bud --network=host --build-arg BUILD_VERSION="$TAG" \
      --env GOFLAGS=-p=16 --env GOMAXPROCS=32 -f "$3" -t "$img" "$2" \
      > ~/aether-dev-logs-$1.log 2>&1 \
    && buildah push "$img" "oci-archive:/tmp/aether-$1.tar:$img" \
      >> ~/aether-dev-logs-$1.log 2>&1 \
    && sudo -n ctr -n k8s.io images import "/tmp/aether-$1.tar" \
      >> ~/aether-dev-logs-$1.log 2>&1 \
    && echo "built $1" \
    || { echo "BUILD FAIL $1"; cat ~/aether-dev-logs-$1.log; exit 1; }
    rm -f "/tmp/aether-$1.tar"
  }
  export -f build; export TAG REG

  { echo "tools . deploy/single-server/Dockerfile.tools"
    for s in "${SVCS[@]}"; do echo "$s backend backend/services/$s/Dockerfile"; done
  } | xargs -P 3 -L1 bash -c 'build "$@"' _

  cd deploy/helm
else
  # ── CI fast path: pull pre-built images from GHCR ─────────────────────────
  echo "Pulling $TAG from GHCR…"
  for s in "${SVCS[@]}" tools; do
    img="$REG/aethercode-$s:$TAG"
    sudo -n ctr -n k8s.io images pull "$img" \
    && echo "pulled $s" \
    || { echo "PULL FAIL $s — did CI finish? Try --build for a local build."; exit 1; }
  done

  # Find the helm chart directory regardless of cwd
  HELM_DIR="$(dirname "$0")/../helm"
  cd "$HELM_DIR"
fi

# ── Helm upgrades (same for both modes) ──────────────────────────────────────
for NS in aethercode aether-test; do
  helm upgrade migrations platform-migrations -n "$NS" \
    --reset-then-reuse-values --set image.tag="$TAG" \
    --wait --timeout 10m 2>&1 \
    | grep -E "^STATUS|Error|error" | sed "s/^/$NS migrations: /" || true

  for s in "${SVCS[@]}"; do
    EXTRA=()
    [[ "$s" == gateway ]] && EXTRA=(--set ingress.enabled=false)
    [[ "$s" == judge && "$NS" == aether-test ]] && EXTRA=(--set networkPolicy.egress.enabled=false)
    helm upgrade "$s" platform-service -n "$NS" \
      --reset-then-reuse-values -f "platform-service/values-$s.yaml" \
      --set image.tag="$TAG" "${EXTRA[@]}" \
      --wait --timeout 5m 2>&1 \
      | grep -E "^STATUS|Error|error" | sed "s/^/$NS $s: /" || true
  done

  for s in "${SVCS[@]}"; do
    kubectl -n "$NS" rollout status deploy/"$s" --timeout=120s 2>&1 \
      | tail -1 | sed "s/^/$NS $s: /"
  done
done

echo "SYNC-DONE $TAG"
