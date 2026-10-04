# Single-server deployment

The whole platform on one machine with Docker Compose (decision D2): the 11
services, PostgreSQL 18, NATS JetStream, MinIO, the judge control plane (its
own PostgreSQL and RabbitMQ) and the code-execution engine: Piston by default
(ADR-0018), or Judge0 on cgroup v1 hosts. Only the gateway is published
(`GATEWAY_PORT`, default 8080); put TLS termination (nginx or Caddy) in front
of it on the campus network.

Internal traffic uses mTLS just like the Kubernetes deployment: each service
gets a certificate from a private CA with `CN=<service>`, `DNS:<service>` and
`URI:spiffe://aethercode.local/<service>`. `AETHERCODE_ENV=production`, so
every production safety check applies.

## Host requirements

- Docker Engine with Compose v2, 8+ cores, 16 GB RAM, about 20 GB of free disk.
- Piston works on cgroup v1 and v2. **Judge0 needs cgroup v1** (`stat -fc %T
  /sys/fs/cgroup` prints `cgroup2fs` on v2): only use it on such a host, with
  `JUDGE_ENGINE=judge0` in `.env` and `--profile judge0`.

## First install

```sh
cd deploy/single-server
./setup.sh                                   # .env, judge0.conf, certs/ (once)
docker compose build
docker compose up -d
docker compose ps                            # every service "running"/"healthy"
```

`setup.sh` refuses to run when `.env`, `judge0.conf` or `certs/` exist, so
secrets are never rotated by accident. All three are gitignored. Back them up
with the database volumes: losing `.env` makes the encrypted objects and the
signed sessions unreadable.

One-shot jobs run before the services start:

| Job | Does |
|---|---|
| `migrate` | Migrates the nine platform databases with their migrator roles, then installs each database's authorization capability key (`migrate-all.sh`, `provision-keys.sh`). |
| `judge-migrate` | Migrates the judge database. |
| `buckets` | Creates the `aethercode` MinIO bucket. |
| `piston-packages` | Installs the newest Piston runtimes for C/C++ (gcc), Java and Python (`piston-packages.js`). |

## First administrator

```sh
set -a; . ./.env; set +a
# The bootstrap functions belong to each schema's owner: connect as the
# migrator and assume the owner role for the session.
BOOT_ID="postgres://aether_identity_migrator:${IDENTITY_DB_PASSWORD}@postgres:5432/aether_identity?sslmode=disable&options=-c%20role%3Daether_identity_owner"
BOOT_USER="postgres://aether_user_migrator:${USERS_DB_PASSWORD}@postgres:5432/aether_users?sslmode=disable&options=-c%20role%3Daether_user_owner"
ID_URL="postgres://aether_identity_app:${IDENTITY_DB_PASSWORD}@postgres:5432/aether_identity?sslmode=disable"

docker compose run --rm --entrypoint bootstrap migrate \
  --identity-database-url "$BOOT_ID" --user-database-url "$BOOT_USER" \
  --email admin@college.edu --display-name "Platform Admin"
```

The account has no password. Activate it with the reset flow; with no email
channel, the operator delivers the reset token out of band:

```sh
curl -s -X POST localhost:${GATEWAY_PORT:-8080}/v1/auth/password-reset \
  -H 'content-type: application/json' -d '{"email":"admin@college.edu"}'

docker compose run --rm --entrypoint deliver-reset \
  -e IDENTITY_DATABASE_URL="$ID_URL" \
  -e IDENTITY_DELIVERY_TOKEN_HMAC_KEY_BASE64="$IDENTITY_DELIVERY_TOKEN_HMAC_KEY_BASE64" \
  migrate --email admin@college.edu         # prints the reset token

curl -s -X POST localhost:${GATEWAY_PORT:-8080}/v1/auth/password-reset/complete \
  -H 'content-type: application/json' \
  -d '{"token":"<token>","password":"<new password>"}'
```

## Backups

Two services write to `deploy/single-server/backups/` (gitignored):

| Service | What | When |
|---|---|---|
| `backup` | `platform-YYYYMMDD-HHMM.sql.gz` and `judge-….sql.gz`: whole-cluster `pg_dumpall` (roles and every database) | every `BACKUP_INTERVAL_MINUTES` (15), kept `BACKUP_RETENTION_DAYS` (7) |
| `backup-objects` | `objects/`: a continuous mirror of the MinIO bucket (encrypted test bundles and code). It never deletes. | on every change |

The objects are encrypted with `PLATFORM_KMS_LOCAL_KEY` from `.env`. **Without
`.env` the object backup cannot be decrypted**, so keep a copy of `.env` (and
`certs/`) somewhere safe off the server. After every exam, copy `backups/` off
the server too. Check that backups are running with
`docker compose logs --tail 5 backup backup-objects`.

Restore onto a fresh server, after running `setup.sh` with the **old** `.env`
and `certs/` in place:

```sh
docker compose up -d postgres judge-db minio buckets
gunzip -c backups/platform-YYYYMMDD-HHMM.sql.gz | docker compose exec -T postgres psql -U aether_admin -d postgres
gunzip -c backups/judge-YYYYMMDD-HHMM.sql.gz | docker compose exec -T judge-db psql -U aether_judge_admin -d aether_judge_wrapper
docker run --rm --network aethercode-platform_default -v "$PWD/backups:/backups" \
  -e MC_HOST_local="http://$MINIO_ROOT_USER:$MINIO_ROOT_PASSWORD@minio:9000" \
  cgr.dev/chainguard/minio-client mirror /backups/objects local/aethercode
docker compose up -d
```

The dump recreates roles and databases, so `psql` reports "already exists"
errors for the ones the fresh containers made; they are harmless.

## Upgrades

```sh
git pull && docker compose build && docker compose up -d
```

`migrate` and `judge-migrate` run again on every `up` and apply only new
migrations.

After every upgrade, run the end-to-end smoke test through the gateway:

```sh
python3 smoke.py   # reads ~/aethercode-admin.txt; prints PASS lines, exits non-zero on failure
```

It creates fresh test data each run (a placement department, a batch,
students, a faculty account) and checks sign-in, account management and the
authorization boundaries.
