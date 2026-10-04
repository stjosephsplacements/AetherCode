#!/bin/bash
# Dumps the platform and judge PostgreSQL clusters every
# BACKUP_INTERVAL_MINUTES into /backups and deletes dumps older than
# BACKUP_RETENTION_DAYS. A dump is the whole cluster (roles, every service
# database), so a restore needs nothing else from the database side. Each
# dump is written to a temporary name first, so a half-written file never
# looks like a good backup. Object storage is mirrored by the
# backup-objects service; the KMS key that decrypts it is in .env.
set -u -o pipefail

dump() {
  local name=$1 host=$2 user=$3 password=$4
  local file="/backups/$name-$(date +%Y%m%d-%H%M).sql.gz"
  if PGPASSWORD=$password pg_dumpall -h "$host" -U "$user" | gzip > "$file.partial"; then
    mv "$file.partial" "$file"
    echo "$(date -Iseconds) backup ok: $file ($(du -h "$file" | cut -f1))"
  else
    rm -f "$file.partial"
    echo "$(date -Iseconds) backup FAILED: $name" >&2
  fi
}

while true; do
  dump platform postgres aether_admin "$PLATFORM_DB_PASSWORD"
  dump judge judge-db aether_judge_admin "$JUDGE_DB_PASSWORD"
  find /backups -maxdepth 1 -name '*.sql.gz' -mtime +"$BACKUP_RETENTION_DAYS" -delete
  sleep $((BACKUP_INTERVAL_MINUTES * 60))
done
