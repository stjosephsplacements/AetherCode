#!/usr/bin/env bash
# Weekly update of the third-party apps on the campus server. Installed as
# /usr/local/bin/aethercode-update.sh and run from root's cron (Sundays 03:00).
#
# What it updates: the Helm-installed platform apps (to the newest chart in the SAME major
# version, with --atomic so a failed upgrade rolls back by itself), the Docker apps under
# /data/production/<app>/compose.yaml (new image, health check, image rollback on failure) and
# Webmin. Before anything it runs the backup and checks the cluster is healthy.
#
# What it never touches: AetherCode, placement and algoqx (released by their own pipelines),
# PostgreSQL and the CloudNativePG operator, MinIO (data), k3s and the kernel (reported only), and
# major version jumps (reported, applied by hand). DRY_RUN=1 pulls images (running containers are not touched) and reports what it would change. OS packages are left to unattended-upgrades
# (security only): a general apt upgrade restarts docker and containerd, and with them every pod.
export PATH=/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin # cron starts with a minimal PATH that lacks k3s and helm
set -uo pipefail

readonly REPORT_DIR=/data/backups/updates
readonly REPORT="$REPORT_DIR/$(date +%Y%m%d-%H%M).log"
readonly KUBECONFIG=/etc/rancher/k3s/k3s.yaml
readonly HELM=(env "KUBECONFIG=$KUBECONFIG" HOME=/home/aethercode helm)
export KUBECONFIG
# release namespace chart-in-repo
readonly RELEASES=(
  "cert-manager cert-manager jetstack/cert-manager"
  "traefik traefik traefik/traefik"
  "loki loki grafana/loki"
  "promtail loki grafana/promtail"
  "velero velero vmware-tanzu/velero"
  "portainer portainer portainer/portainer"
  "kube-prometheus monitoring prometheus-community/kube-prometheus-stack"
  "kyverno kyverno kyverno/kyverno"
  "gitea gitea gitea-charts/gitea"
)
readonly COMPOSE_APPS=(crawl4ai searxng chromium)

mkdir -p "$REPORT_DIR"; exec 9>/var/lock/aethercode-update.lock
flock -n 9 || { echo "another update is running"; exit 1; }
failures=0
log() { printf '%s %s\n' "$(date +%T)" "$*" | tee -a "$REPORT"; }
fail() {
  failures=$((failures + 1)); log "FAILED: $*"; logger -p user.err -t aethercode-update "FAILED: $*"
  [[ -n "${DRY_RUN:-}" ]] || printf '%s %s (report: %s)\n' "$(date -Is)" "$*" "$REPORT" >"$REPORT_DIR/UPDATE_FAILED"
}
not_ready() { k3s kubectl get pods -A --no-headers | awk '$4!="Running" && $4!="Completed"' | wc -l; }

log "== pre-flight"
[[ "$(k3s kubectl get nodes --no-headers | awk '{print $2}')" == Ready ]] || { fail "node not Ready, nothing updated"; exit 1; }
{ [[ -n "${DRY_RUN:-}" ]] || /usr/local/bin/aethercode-backup.sh >>"$REPORT" 2>&1; } || { fail "backup failed, nothing updated"; exit 1; }
baseline=$(not_ready); log "pods not ready before: $baseline"
"${HELM[@]}" repo update >/dev/null 2>&1 || log "warning: helm repo update failed"

log "== helm releases"
for entry in "${RELEASES[@]}"; do
  read -r release namespace chart <<<"$entry"
  current=$("${HELM[@]}" list -n "$namespace" -o json | jq -r --arg r "$release" '.[]|select(.name==$r)|.chart|sub("^.*-(?=v?[0-9]+\\.)";"")') # chart version
  [[ -n "$current" ]] || { log "$release: not installed, skipped"; continue; }
  major="${current#v}"; major="${major%%.*}"
  latest=$("${HELM[@]}" search repo "$chart" --versions -o json | jq -r --arg m "$major" '[.[]|select((.version|sub("^v";"")|split(".")[0])==$m)]|first|.version // empty')
  newest=$("${HELM[@]}" search repo "$chart" -o json | jq -r 'first|.version // empty')
  # an empty search means the repository or the API failed, which must not look like "already current"
  [[ -n "$newest" ]] || { fail "$release: helm search for $chart returned nothing"; continue; }
  [[ -n "$latest" && "$latest" != "$current" ]] || { log "$release: $current is current (newest overall: $newest)"; continue; }
  extra=()
  # portainer's image tag is pinned in its values, so it must follow the chart's app version
  [[ "$release" == portainer ]] && extra=(--set "image.tag=$("${HELM[@]}" search repo "$chart" --version "$latest" -o json | jq -r 'first|.app_version|sub("^.*-";"")')")
  log "$release: $current -> $latest"
  [[ -z "${DRY_RUN:-}" ]] || continue
  if "${HELM[@]}" upgrade "$release" "$chart" -n "$namespace" --version "$latest" --reuse-values --atomic --timeout 10m "${extra[@]}" >>"$REPORT" 2>&1; then
    log "$release: upgraded"
  else
    fail "$release $current -> $latest (rolled back by --atomic)"
  fi
  [[ "$newest" != "$latest" && -n "$newest" ]] && log "$release: newer major $newest available, apply by hand"
done

log "== docker apps"
# update_container <dir> <container> <image> [compose file to restore on failure]
update_container() {
  local dir=$1 cname=$2 image=$3 restore=${4:-} old new state running
  old=$(docker inspect "$cname" --format '{{.Image}}' 2>/dev/null)
  (cd "$dir" && docker compose pull -q >>"$REPORT" 2>&1) || { fail "$cname image pull"; return; }
  new=$(docker image inspect "$image" --format '{{.Id}}')
  [[ "$old" != "$new" ]] || { log "$cname: current"; return; }
  log "$cname: ${old:7:12} -> ${new:7:12}"
  [[ -z "${DRY_RUN:-}" ]] || return
  if (cd "$dir" && docker compose up -d >>"$REPORT" 2>&1); then
    state=starting
    for _ in $(seq 1 30); do
      state=$(docker inspect "$cname" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>/dev/null)
      [[ "$state" == healthy || "$state" == running ]] && break; sleep 4
    done
    running=$(docker inspect "$cname" --format '{{.Image}}' 2>/dev/null)
    [[ ( "$state" == healthy || "$state" == running ) && "$running" == "$new" ]] && return
    fail "$cname not healthy on the new image (state $state)"
  else
    fail "$cname compose up failed"
  fi
  # roll back: restore the previous compose file, or re-tag the previous image
  if [[ -n "$restore" ]]; then cp "$restore" "$dir/compose.yaml"; else docker tag "$old" "$image"; fi
  (cd "$dir" && docker compose up -d --force-recreate >>"$REPORT" 2>&1) || fail "$cname rollback"
}
for app in "${COMPOSE_APPS[@]}"; do
  dir="/data/production/$app"; [[ -f "$dir/compose.yaml" ]] || { log "$app: no compose file, skipped"; continue; }
  update_container "$dir" "$(awk '/container_name:/{print $2}' "$dir/compose.yaml")" "$(awk '/image:/{print $2; exit}' "$dir/compose.yaml")"
done
# the Portainer agent must match the Portainer server version
agent=/data/production/portainer-agent
if [[ -f "$agent/compose.yaml" ]]; then
  want=$(k3s kubectl -n portainer get deploy portainer -o jsonpath='{.spec.template.spec.containers[0].image}' | sed 's/.*://')
  if grep -q "portainer/agent:$want" "$agent/compose.yaml"; then log "portainer_agent: matches server $want"
  elif [[ -n "${DRY_RUN:-}" ]]; then log "portainer_agent: would move to $want"
  else
    # pull first, so a failed pull leaves compose.yaml untouched and the next run tries again
    docker pull -q "portainer/agent:$want" >>"$REPORT" 2>&1 || { fail "portainer_agent pull of $want"; want=""; }
  fi
  if [[ -n "$want" && -z "${DRY_RUN:-}" ]] && ! grep -q "portainer/agent:$want" "$agent/compose.yaml"; then
    cp "$agent/compose.yaml" "$agent/compose.yaml.previous"
    sed -i "s#portainer/agent:[0-9.]*#portainer/agent:$want#" "$agent/compose.yaml"
    update_container "$agent" portainer_agent "portainer/agent:$want" "$agent/compose.yaml.previous"
  fi
fi

log "== webmin"
installed=$(dpkg-query -W -f='${Version}' webmin 2>/dev/null)
latest_webmin=$(curl -fsS --max-time 20 https://api.github.com/repos/webmin/webmin/releases/latest | jq -r '.tag_name // empty')
if [[ -z "$latest_webmin" || "$latest_webmin" == "$installed" ]]; then log "webmin: $installed is current"
elif [[ -n "${DRY_RUN:-}" ]]; then log "webmin: $installed -> $latest_webmin"
else
  log "webmin: $installed -> $latest_webmin"
  tmp=$(mktemp -d)
  if curl -fsSL -o "$tmp/webmin.deb" "https://github.com/webmin/webmin/releases/download/$latest_webmin/webmin_${latest_webmin}_all.deb" \
     && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq -o Dpkg::Options::=--force-confold "$tmp/webmin.deb" >>"$REPORT" 2>&1 \
     && systemctl is-active --quiet webmin; then log "webmin: updated"; else fail "webmin $latest_webmin"; fi
  rm -rf "$tmp"
fi

log "== reported only"
log "k3s: $(k3s --version | head -1); pending apt packages: $(apt list --upgradable 2>/dev/null | grep -c upgradable); reboot required: $([[ -f /var/run/reboot-required ]] && echo yes || echo no)"

log "== post-check"
after=$(not_ready); log "pods not ready after: $after (before: $baseline)"
[[ "$after" -le "$baseline" ]] || fail "more pods not ready than before the update"
[[ "$(k3s kubectl -n velero get backupstoragelocations.velero.io default -o jsonpath='{.status.phase}' 2>/dev/null)" == Available ]] || fail "Velero storage location not Available"

(( failures == 0 )) || exit 1
[[ -n "${DRY_RUN:-}" ]] || rm -f "$REPORT_DIR/UPDATE_FAILED"
log "update finished without failures"
