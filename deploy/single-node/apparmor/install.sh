#!/usr/bin/env bash
# Loads the aethercode-postgres AppArmor profile on this node. Run it (as a user with sudo)
# before applying deploy/single-node/postgres-cluster.yaml; without the profile the database
# pod cannot start. Idempotent, and the profile is reloaded at boot from /etc/apparmor.d.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
sudo install -m 644 "$here/aethercode-postgres" /etc/apparmor.d/aethercode-postgres
sudo apparmor_parser -r /etc/apparmor.d/aethercode-postgres
loaded="$(sudo aa-status)"
grep -q 'aethercode-postgres' <<<"$loaded" && echo 'aethercode-postgres loaded'
