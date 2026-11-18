#!/usr/bin/env bash
# Nightly logical backup of every CloudNativePG database on the campus server, plus the host
# configuration. Installed as /usr/local/bin/aethercode-backup.sh and run from root's cron at 02:00.
# It replaces two cron entries that pointed at scripts that no longer exist and sent their output
# to /dev/null. Failure is loud: a non-zero exit, a line in the journal and /data/backups/FAILED.
#
# Limits: pg_dump is a point-in-time copy, not WAL archiving (CloudNativePG's own backup block does
# that, see postgres-backup.yaml); it lives on the same server as the databases.
export PATH=/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin # cron starts with a minimal PATH that lacks k3s and helm
set -euo pipefail

readonly ROOT=/data/backups
readonly KEEP_DAYS=14
readonly STAMP="$(date +%Y%m%d-%H%M)"
readonly DEST="$ROOT/daily/$STAMP"
readonly KUBECTL=(k3s kubectl)
# namespace:cluster
readonly CLUSTERS=(
  production:postgres-cluster
  placement-prod:placement-db
  placement-dev:placement-db
  aethercode-dev:postgres-cluster
  aethercode-prod:postgres-cluster
)

fail() {
  logger -p user.err -t aethercode-backup "FAILED: $*"
  printf '%s %s\n' "$(date -Is)" "$*" >"$ROOT/FAILED"
  echo "FAILED: $*" >&2
  exit 1
}
trap 'fail "unexpected error on line $LINENO"' ERR

umask 077
mkdir -p "$DEST"

for entry in "${CLUSTERS[@]}"; do
  ns="${entry%%:*}"; cluster="${entry##*:}"
  pod="$("${KUBECTL[@]}" -n "$ns" get pods -l "cnpg.io/cluster=$cluster,cnpg.io/instanceRole=primary" -o name | head -1)"
  [[ -n "$pod" ]] || fail "no primary pod for $ns/$cluster"
  out="$DEST/$ns-$cluster"
  mkdir -p "$out"
  "${KUBECTL[@]}" -n "$ns" exec "$pod" -c postgres -- pg_dumpall -U postgres --globals-only >"$out/globals.sql"
  # captured in a checked substitution: mapfile < <(...) would hide a failed query and skip every dump
  names="$("${KUBECTL[@]}" -n "$ns" exec "$pod" -c postgres -- \
    psql -U postgres -Atc "select datname from pg_database where not datistemplate and datname <> 'postgres'")" \
    || fail "cannot list databases of $ns/$cluster"
  mapfile -t databases <<<"$names"
  for database in "${databases[@]}"; do
    # The dump is checked with pg_restore inside the pod and streamed out only if it is readable
    # (pg_restore --list over `kubectl exec -i` stdin hangs). An unreadable dump leaves an empty file.
    "${KUBECTL[@]}" -n "$ns" exec "$pod" -c postgres -- sh -c \
      'f=$(mktemp) && pg_dump -U postgres -Fc "$1" >"$f" && pg_restore --list "$f" >/dev/null && cat "$f"; r=$?; rm -f "$f"; exit $r' _ "$database" \
      >"$out/$database.dump"
    [[ -s "$out/$database.dump" ]] || fail "empty or unreadable dump $ns/$cluster/$database"
  done
done

tar czf "$DEST/host-config.tgz" --warning=no-file-changed \
  /etc/ssh /etc/ufw /etc/fail2ban /etc/webmin /etc/cloudflared /etc/cron.d /etc/systemd/system/*.service \
  /data/production/litellm /data/production/searxng/config /data/production/*/compose.yaml /data/production/*/.env 2>/dev/null || [[ $? -eq 1 ]]
crontab -l >"$DEST/root-crontab.txt" 2>/dev/null || true

(cd "$DEST" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum >SHA256SUMS)
find "$ROOT/daily" -mindepth 1 -maxdepth 1 -type d -mtime "+$KEEP_DAYS" -exec rm -rf {} +
rm -f "$ROOT/FAILED"
date -Is >"$ROOT/LAST_SUCCESS"
logger -t aethercode-backup "ok: $DEST ($(du -sh "$DEST" | cut -f1))"
