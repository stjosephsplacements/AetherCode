# Single-server deployment

The whole platform on one machine with Docker Compose (decision D2): the 11
services, PostgreSQL 18, NATS JetStream, MinIO, the judge control plane (its
own PostgreSQL and RabbitMQ). Code runs on the AetherCode Execution Engine,
which runs on the host as a systemd service, outside Compose (ADR-0028); Judge0
is an alternative on cgroup v1 hosts. Only the gateway is published,
on loopback (`127.0.0.1:GATEWAY_PORT`, default 8080); the host nginx serves it
publicly over TLS (see "Public address").

Internal traffic uses mTLS just like the Kubernetes deployment: each service
gets a certificate from a private CA with `CN=<service>`, `DNS:<service>` and
`URI:spiffe://aethercode.local/<service>`. `AETHERCODE_ENV=production`, so
every production safety check applies.

## Host requirements

- Docker Engine with Compose v2, 8+ cores, 16 GB RAM, about 20 GB of free disk.
- The AetherCode Execution Engine installed on the host
  (github.com/stjosephsplacements/AetherCode-Execution-Engine) and listening on
  the docker0 address only, `AC_GATEWAY_ADDR=172.17.0.1:5100`: it has no
  authentication, so it must not listen on a public interface. Check it with
  `curl http://172.17.0.1:5100/api/v1/health`. Judge reaches it at
  `host.docker.internal:5100` (`AETHERCODE_ENGINE_URL`).
- **Judge0 needs cgroup v1** (`stat -fc %T /sys/fs/cgroup` prints `cgroup2fs`
  on v2): only use it on such a host, with `JUDGE_ENGINE=judge0` in `.env` and
  `--profile judge0`.

## First install

```sh
cd deploy/single-server
./setup.sh https://exam.example.edu          # .env, judge0.conf, certs/ (once)
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
curl -s -X POST localhost:${GATEWAY_PORT:-8080}/api/identity/v1/auth/password-reset \
  -H 'content-type: application/json' -d '{"email":"admin@college.edu"}'

docker compose run --rm --entrypoint deliver-reset \
  -e IDENTITY_DATABASE_URL="$ID_URL" \
  -e IDENTITY_DELIVERY_TOKEN_HMAC_KEY_BASE64="$IDENTITY_DELIVERY_TOKEN_HMAC_KEY_BASE64" \
  migrate --email admin@college.edu         # prints the reset token

curl -s -X POST localhost:${GATEWAY_PORT:-8080}/api/identity/v1/auth/password-reset/complete \
  -H 'content-type: application/json' \
  -d '{"token":"<token>","password":"<new password>"}'
```

## Public address

The host's own nginx terminates TLS for the public domain (`PUBLIC_ORIGIN` in
`.env`), which in the reference deployment Cloudflare proxies through the
host's cloudflared tunnel. Edit `server_name` and the certificate paths in
`nginx-site.conf` first. Requests therefore reach nginx from loopback, and the site
restores the student's address from `CF-Connecting-IP`. Install the site once:

```sh
sudo cp nginx-site.conf /etc/nginx/sites-available/aethercode
sudo ln -sf /etc/nginx/sites-available/aethercode /etc/nginx/sites-enabled/aethercode
sudo nginx -t && sudo systemctl reload nginx
```

nginx sends every request to the `frontend` service (the web UI, ADR-0024) on
`127.0.0.1:3000` (`FRONTEND_PORT`). The frontend serves the pages and forwards
`/api/...` to the gateway under the same path, adding the session's bearer
from its cookie, so Safe Exam Browser's request hashes still verify.
`PUBLIC_ORIGIN` must be the exact origin students type; the frontend refuses
API writes from any other origin.

The gateway trusts `X-Forwarded-For` only from listed addresses. The frontend
reaches it from its fixed address on the `edge` network, `10.231.240.2`, which
is the default. If `.env` sets `GATEWAY_TRUSTED_PROXY_CIDRS` (an older setup
listed the bridge gateway nginx used to connect from), add the frontend:

```sh
# in .env, keeping any address already listed
GATEWAY_TRUSTED_PROXY_CIDRS=["10.231.240.2/32","172.27.0.1/32"]
docker compose up -d gateway frontend
```

Without it every request appears to come from the frontend, so per-IP login
limits and lab network rules would treat all students as one address. The
gateway stays published on loopback for `smoke.py` and administration.

## Single sign-on

Students and staff can sign in with their St. Joseph's account at
`sso.stjosephsplacements.in` (ZITADEL, ADR-0042). The AetherCode password
always keeps working, so exams never depend on it. To turn it on:

1. In ZITADEL's `.env`, set
   `ZITADEL_SYSTEMDEFAULTS_PASSWORDHASHER_VERIFIERS=argon2` and restart
   `zitadel-server`, so AetherCode's password hashes can be imported.
2. In the ZITADEL console, create a project with an OIDC **Web**
   application:
   - authentication method **Basic**;
   - redirect URI `https://aethercode.stjosephsplacements.in/auth/sso/callback`;
   - post-logout URI `https://aethercode.stjosephsplacements.in/login`.

   Note the client ID and secret.
3. Create a service user with the **Org Owner** role, generate a personal
   access token, and save it as `certs/sso-admin.pat` (`chmod 600`).
4. In `.env`, set:
   - `IDENTITY_SSO_ISSUER=https://sso.stjosephsplacements.in`
   - `IDENTITY_SSO_CLIENT_ID` and `IDENTITY_SSO_CLIENT_SECRET`
   - `IDENTITY_SSO_ADMIN_TOKEN_FILE=/certs/sso-admin.pat`
   - `IDENTITY_SSO_ORGANIZATION_ID` (the organization's ID)
   - `IDENTITY_SSO_EMAIL_DOMAIN` (e.g. `students.stjosephs.ac.in`)
   - `AETHERCODE_SSO=on`
5. `docker compose up -d identity frontend`.

Every existing account is then copied to ZITADEL within minutes. Accounts
the provider already has are linked, not duplicated.

## Question review

Set `QBANK_REQUIRE_REVIEW=true` in `.env` to make publishing a question need
a review request from another member of staff (ADR-0044). It is off by
default, so a college with one author is not blocked.

## College branding

Put `branding.json` and the logo files in `deploy/single-server/branding/`
(see `frontend/README.md`, "Branding"). The frontend picks changes up without a
restart. Without the file the UI keeps the AetherCode name and colours.

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

## Exam languages

Judge accepts a submission only in a language listed and enabled in
`judge.language_mappings`. The `judge-languages` one-shot (`judge-languages.sh`)
enables C, C++17, Java, Python 3, JavaScript and Go for `JUDGE_ENGINE` after
every migration run; the judge starts only after it succeeds. To withdraw a
language, set `enabled = false` on its row.

## Engine check and load test (M8)

`make engine-check` (or `python3 engine-check.py`) runs a correct, a wrong, a
slow and a broken program in every exam language as model-solution checks,
end to end through the gateway, Question Bank, Judge and the engine. It must
print `Engine OK`. It keeps one draft question, `engine-check`, in the
administrator's drafts.

`STUDENTS=1000 RAMP=60 make loadtest` (or `python3 loadtest.py --students
1000 --ramp 60 --runs 3`) creates a batch of students and a one-question exam
named `LOADTEST-<run>`. Each student then signs in, starts the exam, loads
the paper, autosaves, runs code, submits the question and ends the test. It
prints p50/p95/p99 latency per step and the time Judge takes to return
verdicts. Never run it during a real exam. Like `smoke.py`, it leaves its
data behind.

## Upgrades

```sh
git pull && docker compose build && docker compose up -d
```

`migrate` and `judge-migrate` run again on every `up` and apply only new
migrations.

When an upgrade adds fields to an event, start its consumers first. Each
step's consumer rejects fields it does not know, so the order matters:
Submission reads Assessment's new snapshot fields (ADR-0023), and Assessment
reads User's (ADR-0026).

```sh
git pull && docker compose build
docker compose up -d migrate submission   # reads Assessment's new fields
docker compose up -d assessment           # reads User's new fields
docker compose up -d seb                  # accepts Gateway's client_ip (ADR-0030)
docker compose up -d                      # everything else, User included
```

### Release checklist for the 2026-10-21 batch

1. **Back up first**, and confirm the dump restores (`backup.sh`; see Backups).
2. `git pull && docker compose build`. The new migrations are user `000029`
   and `000030`, submission `000035`, assessment `000033`, question-bank
   `000019` to `000021` and notification `000013`. None changes an event, so
   the consumer-first order above is not needed; run `docker compose up -d`.
3. Check the `migrate` one-shot exited 0 (`docker compose ps migrate`,
   `docker compose logs migrate`) before judging anything else.
4. `python3 smoke.py`. It now also checks that publishing needs a passing
   model solution (ADR-0047), the community content routes (ADR-0048) and a staff member trying
   an exam (ADR-0046).
5. In a browser as a student: sign in, open Contests, Interviews, Blogs and
   My profile; as faculty: Community, Calendar and a question with a passing
   model check. A 403 on a Community page means the User service has not
   picked up migration `000030` yet.
6. Optional switches in `.env`: `QBANK_REQUIRE_REVIEW=true` (publishing needs
   another member of staff); `deploy/single-server/branding/branding.json`
   (see the College branding section).
7. Rollback: every migration has a down file (`migrate --direction down` runs
   all of them, so restore the backup instead if more than one step is
   wrong). Redeploy the previous images from git.

After every upgrade, run the end-to-end smoke test through the gateway:

```sh
python3 smoke.py   # reads ~/aethercode-admin.txt; prints PASS lines, exits non-zero on failure
```

It creates fresh test data each run (a placement department, a batch,
students, a faculty account) and checks sign-in, account management and the
authorization boundaries.
