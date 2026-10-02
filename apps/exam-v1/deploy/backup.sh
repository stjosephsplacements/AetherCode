#!/bin/sh
# Dumps the exam database every BACKUP_INTERVAL_MINUTES into /backups and
# deletes dumps older than BACKUP_RETENTION_DAYS. Writes to a temp file first so
# a half-written dump never looks like a good one.
set -u
while true; do
  file="/backups/exam-$(date +%Y%m%d-%H%M).dump"
  if pg_dump -h db -U exam -Fc exam > "$file.partial"; then
    mv "$file.partial" "$file"
    echo "$(date -Iseconds) backup ok: $file ($(du -h "$file" | cut -f1))"
  else
    rm -f "$file.partial"
    echo "$(date -Iseconds) backup FAILED" >&2
  fi
  find /backups -name 'exam-*.dump' -mtime +"$BACKUP_RETENTION_DAYS" -delete
  sleep $((BACKUP_INTERVAL_MINUTES * 60))
done
