#!/usr/bin/env bash
# Live-dev deploy: dev-sync.sh <sha> [service ...]
#
# Two modes:
#   CI mode (default):  images were built and pushed to GHCR by CI.
#                       Pulls pre-built images and runs helm upgrade. ~2 min.
#   Local mode (--build): builds on the server from /tmp/aether-dev-src.tgz.
#                         Use only when CI is unavailable or for urgent hotfixes.
#
# Prereqs on the server (one-time setup):
#   /etc/rancher/k3s/registries.yaml must contain GHCR credentials — run:
#     sudo bash /data/production/AetherCode_Production_StJosephs/deploy/dev/setup-ghcr-auth.sh
#
# Usage (run from anywhere on the server):
#   dev-sync.sh <sha> [service ...]           # pull pre-built images from GHCR
#   dev-sync.sh --build <sha> [service ...]   # build on server (slow fallback)
set -euo pipefail

REPO_DIR=/data/production/AetherCode_Production_StJosephs
REG=ghcr.io/stjosephsplacements

BUILD=false
if [[ "${1:-}" == "--build" ]]; then BUILD=true; shift; fi
SHA=$1; shift; SVCS=("$@")
TAG=$SHA

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
    && sudo ctr -n k8s.io images import "/tmp/aether-$1.tar" \
      >> ~/aether-dev-logs-$1.log 2>&1 \
    && echo "built $1" \
    || { echo "BUILD FAIL $1"; cat ~/aether-dev-logs-$1.log; exit 1; }
    rm -f "/tmp/aether-$1.tar"
  }
  export -f build; export TAG REG

  { echo "tools . deploy/single-server/Dockerfile.tools"
    for s in "${SVCS[@]}"; do echo "$s backend backend/services/$s/Dockerfile"; done
  } | xargs -P 3 -L1 bash -c 'build "$@"' _

else
  # ── CI fast path: pull pre-built images from GHCR ─────────────────────────
  # GHCR_TOKEN is passed from CI via SSH SendEnv / environment.
  # Fallback to /etc/rancher/k3s/registries.yaml credentials if not set.
  PULL_OPTS=()
  if [[ -n "${GHCR_TOKEN:-}" ]]; then
    PULL_OPTS=(--user "x-access-token:${GHCR_TOKEN}")
  fi

  echo "Pulling $TAG from GHCR…"
  for s in "${SVCS[@]}" tools; do
    img="$REG/aethercode-$s:$TAG"
    sudo -E ctr -n k8s.io images pull "${PULL_OPTS[@]}" "$img" \
    && echo "  pulled $s" \
    || { echo "PULL FAIL $s — is CI done? Try: dev-sync.sh --build $SHA ${SVCS[*]}"; exit 1; }
  done
fi

# ── Helm upgrades (shared for both modes) ─────────────────────────────────────
cd "$REPO_DIR/deploy/helm"
for NS in aethercode aether-test; do
  helm upgrade migrations platform-migrations -n "$NS" \
    --reset-then-reuse-values --set image.tag="$TAG" \
    --wait --timeout 10m 2>&1 \
    | grep -E "^STATUS|[Ee]rror" | sed "s/^/$NS migrations: /" || true

  for s in "${SVCS[@]}"; do
    EXTRA=()
    [[ "$s" == gateway ]] && EXTRA=(--set ingress.enabled=false)
    [[ "$s" == judge && "$NS" == aether-test ]] && EXTRA=(--set networkPolicy.egress.enabled=false)
    helm upgrade "$s" platform-service -n "$NS" \
      --reset-then-reuse-values -f "platform-service/values-$s.yaml" \
      --set image.tag="$TAG" "${EXTRA[@]}" \
      --wait --timeout 5m 2>&1 \
      | grep -E "^STATUS|[Ee]rror" | sed "s/^/$NS $s: /" || true
  done

  for s in "${SVCS[@]}"; do
    kubectl -n "$NS" rollout status deploy/"$s" --timeout=120s 2>&1 \
      | tail -1 | sed "s/^/$NS $s: /"
  done
done

echo "SYNC-DONE $TAG"
