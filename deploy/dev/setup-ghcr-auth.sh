#!/usr/bin/env bash
# One-time setup: configure k3s containerd to pull from GHCR.
# Run once on the server as root (or with sudo):
#   sudo bash /data/production/AetherCode_Production_StJosephs/deploy/dev/setup-ghcr-auth.sh
#
# Requires a GitHub Personal Access Token with read:packages scope.
# Generate at: https://github.com/settings/tokens/new?scopes=read:packages
# The token is stored in /etc/rancher/k3s/registries.yaml (root-readable only).
set -euo pipefail

if [[ $EUID -ne 0 ]]; then echo "Run as root (sudo $0)"; exit 1; fi

read -rp "GitHub username (e.g. AlgoQX): " GH_USER
read -rsp "GitHub PAT (read:packages scope): " GH_TOKEN
echo

REGISTRIES_FILE=/etc/rancher/k3s/registries.yaml

cat > "$REGISTRIES_FILE" << YAML
mirrors:
  ghcr.io:
    endpoint:
      - "https://ghcr.io"

configs:
  "ghcr.io":
    auth:
      username: "${GH_USER}"
      password: "${GH_TOKEN}"
YAML

chmod 600 "$REGISTRIES_FILE"
echo "Wrote $REGISTRIES_FILE"

echo "Restarting k3s to pick up registry config…"
systemctl restart k3s
echo "Done. Test with: sudo ctr -n k8s.io images pull ghcr.io/stjosephsplacements/aethercode-gateway:latest"
