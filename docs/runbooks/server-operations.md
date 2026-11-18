# Campus server: backups and weekly updates

Scripts live in `deploy/single-node/host/` and are installed in `/usr/local/bin/`. Root's cron runs them.

| Job | When | Script | Output |
|---|---|---|---|
| Backup | daily 02:00 | `aethercode-backup.sh` | `/data/backups/daily/<stamp>/` (a `pg_dump` of every CloudNativePG database, host config, `SHA256SUMS`); 14 days kept; `/data/backups/LAST_SUCCESS` or `/data/backups/FAILED` |
| Update | Sundays 03:00 | `aethercode-update.sh` | `/data/backups/updates/<stamp>.log`; `UPDATE_FAILED` marker next to it on any failure |

Where app files live: `/data/production/<app>/` (compose file, `.env`, config, data).

## Update rules
- Runs the backup first and stops if the cluster is not healthy.
- Helm apps (cert-manager, traefik, loki, promtail, velero, portainer, kube-prometheus-stack, kyverno) move to the newest chart of the
  same major version with `--atomic`; a failed upgrade rolls back by itself. A newer major is only reported.
- Docker apps (`/data/production/{crawl4ai,searxng,chromium,portainer-agent}`) pull the new image, must pass a health check, and
  roll back to the previous image if not. Webmin follows its latest GitHub release.
- Never touched: AetherCode, placement, algoqx, PostgreSQL and the CloudNativePG operator, MinIO, k3s, the kernel. OS packages are
  left to `unattended-upgrades` (security only), because a general apt upgrade restarts docker and containerd and every pod with them.
- `DRY_RUN=1 /usr/local/bin/aethercode-update.sh` reports what would change and changes nothing.

## When it fails
Read the newest file in `/data/backups/updates/`. Helm rollbacks are automatic; check `helm history <release> -n <ns>`. A Docker app
that failed its health check was already restored to the previous image.

## Gotcha
`helm upgrade --reuse-values` re-applies the credentials stored in the release. If a Secret is changed by hand, update the Helm values
too, or the next upgrade silently reverts it (this broke Velero's MinIO login once; Velero now uses its own bucket-scoped user).
