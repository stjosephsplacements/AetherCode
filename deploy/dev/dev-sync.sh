#!/usr/bin/env bash
# Live-dev deploy: dev-sync.sh <sha> [service ...]. Source tarball must be at /tmp/aether-dev-src.tgz.
# Rebuilds the tools image (migrations) and the named services, then upgrades both namespaces.
set -uo pipefail
SHA=$1; shift; SVCS=("$@"); TAG=dev-$SHA; REG=ghcr.io/stjosephsplacements
rm -rf ~/aether-dev && mkdir -p ~/aether-dev && tar -xzf /tmp/aether-dev-src.tgz -C ~/aether-dev && chmod -R o+rX ~/aether-dev
cd ~/aether-dev
build() { # name context dockerfile
  local img="$REG/aethercode-$1:$TAG"
  buildah bud --network=host --build-arg BUILD_VERSION="$TAG" --env GOFLAGS=-p=16 --env GOMAXPROCS=32 -f "$3" -t "$img" "$2" > ~/aether-dev-logs-$1.log 2>&1 \
   && buildah push "$img" "oci-archive:/tmp/aether-$1.tar:$img" >> ~/aether-dev-logs-$1.log 2>&1 \
   && sudo -n ctr -n k8s.io images import "/tmp/aether-$1.tar" >> ~/aether-dev-logs-$1.log 2>&1 && echo "built $1" || { echo "BUILD FAIL $1"; exit 1; }
  rm -f "/tmp/aether-$1.tar"
}
export -f build; export TAG REG
{ echo "tools . deploy/single-server/Dockerfile.tools"; for s in "${SVCS[@]}"; do echo "$s backend backend/services/$s/Dockerfile"; done; } | xargs -P 3 -L1 bash -c 'build "$@"' _
cd deploy/helm
for NS in aethercode aether-test; do
  helm upgrade migrations platform-migrations -n $NS --reset-then-reuse-values --set image.tag=$TAG --wait --timeout 10m 2>&1 | grep -E "^STATUS|Error" | sed "s/^/$NS migrations: /"
  for s in "${SVCS[@]}"; do
    EXTRA=(); [ $s = gateway ] && EXTRA=(--set ingress.enabled=false); [ $s = judge ] && [ $NS = aether-test ] && EXTRA=(--set networkPolicy.egress.enabled=false)
    helm upgrade $s platform-service -n $NS --reset-then-reuse-values -f platform-service/values-$s.yaml --set image.tag=$TAG "${EXTRA[@]}" 2>&1 | grep -E "^STATUS|Error" | sed "s/^/$NS $s: /"
  done
  for s in "${SVCS[@]}"; do kubectl -n $NS rollout status deploy/$s --timeout=240s 2>&1 | tail -1 | sed "s/^/$NS $s: /"; done
done
echo SYNC-DONE
