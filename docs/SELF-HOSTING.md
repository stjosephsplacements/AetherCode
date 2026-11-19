# Self-hosting AetherCode

AetherCode is proprietary software. You may install it only under a written licence from St. Joseph's
Group of Institutions (see [LICENSE](../LICENSE)); the licence names what you may run and where. This guide is for
the licensed college's technical team. The commands live in the deployment guides; this page tells you which
one to use, what to prepare and how to know it works.

## 1. Choose a deployment

| | Single server (Docker Compose) | Kubernetes (Helm) |
|---|---|---|
| Fits | One campus, up to a few thousand students, one ops person | Several colleges or high availability |
| Guide | [deploy/single-server/README.md](../deploy/single-server/README.md) | [deploy/helm/README.md](../deploy/helm/README.md), [deploy/single-node](../deploy/single-node) for one k3s node |
| Database | One PostgreSQL 18 container, volume backups | One PostgreSQL instance from the infra chart. High availability and point-in-time recovery are optional: install the `platform-postgres-ha` chart (three-node CloudNativePG) and follow [its runbook](runbooks/platform-postgres-ha.md) |
| Scale-out | Vertical | Horizontal (autoscaling gateway, identity, submission, judge) |

If unsure, start with a single server. Moving to Kubernetes later is a data migration, not a rewrite.

## 2. Prepare

**Hardware (single server).** 8+ cores, 16 GB RAM and 20 GB free disk is the floor for a trial. For a real exam
cohort plan about one core per 15 simultaneous students for the judge and execution engine, 32 GB RAM, SSD storage
and a second disk or remote location for backups. The execution engine runs student code, so give it its own cores:
it is the first thing to saturate during a burst of Run and Submit.

**Software.** Linux with Docker Engine and Compose v2, an nginx (or other TLS terminator), the AetherCode Execution
Engine as a host service, and Safe Exam Browser on lab machines if you lock exams down. Time must be correct
(NTP); the server owns exam deadlines.

**Network.** One public hostname with a TLS certificate (`PUBLIC_ORIGIN`). Publish only HTTPS. Never publish the
gateway port, the execution engine (it has no authentication), PostgreSQL, NATS, MinIO or RabbitMQ.
Lab machines need to reach the hostname; students' browsers need nothing else.

**Secrets.** Single server: `setup.sh` generates `.env` and the private CA once; back both up with the database, because losing
`.env` makes encrypted objects and sessions unreadable. Kubernetes: `deploy/helm/generate-secrets.sh` writes the Kubernetes
Secret (see the Helm guide); keep a copy in your password manager or sealed-secrets store. In both cases do not commit them, and
rotate by following the runbooks, not by re-running the generator.

**Password recovery.** There is no email channel in this release. Staff reset a student's password from the student's page, and
the operator can deliver an administrator's reset token out of band with `deliver-reset` ("First administrator" in the
single-server guide). Notifications are shown in the app.

## 3. Install

1. Follow "First install" in the single-server guide (or the Helm guide). Compose: the one-shot jobs `migrate`,
   `judge-migrate` and `buckets` must exit 0. Helm: the migration hook jobs (including the proctor migration) and the
   `judge-languages` job must complete; check them with `kubectl get jobs`.
2. Install the execution engine and check it. `engine-check.py` takes the credentials file and the gateway URL (the Compose gateway
   listens on `127.0.0.1:${GATEWAY_PORT:-8080}`, but the script defaults to 8380):
   `python3 engine-check.py ~/aethercode-admin.txt http://127.0.0.1:8080` must print `Engine OK`.
3. Create the first administrator ("First administrator" in the guide), set their password with the reset flow and
   enrol an authenticator app (TOTP). Elevated actions ask for a fresh second factor.
4. Put nginx and TLS in front ("Public address"), then open `https://<your host>/login`.
5. Run `python3 smoke.py ~/aethercode-admin.txt http://127.0.0.1:8080` (same arguments). It exercises sign-in, authoring,
   an exam, judging and results end to end.

## 4. Day-0 checklist (one college)

1. Sign in as the platform administrator; create the college ("Colleges").
2. Create the college administrator and have them sign in and change the password.
3. As college administrator: create departments and batches, then import students from CSV. Students get initial passwords
   and must change them at first sign-in.
4. Add faculty accounts and give them roles (see [ROLES.md](ROLES.md)).
5. Faculty author questions with sample and hidden tests; a model solution must pass every test before publishing.
6. Build an exam: questions or pools, window, duration, language limits, proctor policy, Safe Exam Browser if needed.
7. Run a rehearsal with real lab machines using `/system-check` and a short practice exam.
8. On exam day: use the live monitor, handle recovery and extra time, then release results and export the CSV.

Each role also has an in-app `/…/get-started` page. See [GETTING-STARTED.md](GETTING-STARTED.md).

## 5. Capacity and limits

- Rate limits protect sign-in and code execution per client address. A whole lab behind one campus NAT address looks like
  one client: raise `IDENTITY_LOGIN_BURST`/`IDENTITY_LOGIN_RATE` and the gateway token bucket for that address, or the
  first students signing in will be refused.
- Password hashing (Argon2id) is deliberately slow and memory-bound; identity limits concurrent hashes. A simultaneous
  sign-in of thousands needs more identity replicas, not a weaker hash.
- The execution engine sheds load with `429` and `Retry-After` when its queue is longer than twice its worker count.
  That is back-pressure, not an outage: the judge retries. Size workers so the p95 verdict time you measure with
  `loadtest.py` is acceptable.
- Rehearse at your real size outside exam hours and read the per-step latencies:
  `python3 loadtest.py --students <n> --gateway http://127.0.0.1:8080` (or `STUDENTS=<n> make loadtest` from the repository root).

## 6. Operate

| Task | Where |
|---|---|
| Health | `docker compose ps`; `/status` page; `GET /readyz` on each service |
| Backups | `backup.sh` (single server) or the PostgreSQL runbook; restore-test monthly |
| Upgrades | "Upgrades" in the single-server guide: back up, pull, build, `up -d`, check `migrate` exited 0, run `smoke.py` |
| Rollback | Every migration has a down file; after more than one step, restore the backup instead |
| Audit | Admin and staff audit log pages; each read of student personal data is recorded |
| Branding and SSO | "College branding" and "Single sign-on" in the guide |

## 7. Security checklist

- TLS only; HSTS on; the nginx site restores client addresses from a trusted header only.
- SSH key-only and a firewall that exposes just 443 (and your admin source addresses).
- Back up `.env`, the CA and the database off the server and test a restore.
- Keep the execution engine on the docker bridge or a private network; it runs student code and has no authentication.
- Keep go-judge isolated. Running it under gVisor is optional and must be tested first (see the engine repo's `docs/GVISOR.md`).
- Give staff the smallest role that works; require TOTP for administrators; review the audit log after each exam.
- Apply security updates to the host, Docker and images; rebuild images on each release.

## 8. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Run/Submit stay "queued" and the judge logs `engine stayed busy` | The engine is rejecting with 429. Check its queue depth and worker count; older engine builds counted retained stream history as queue depth, so upgrade to a build that counts waiting jobs only. |
| Verdicts never arrive after a message-broker restart | Restart the judge so its consumers reconnect (current builds reconnect on their own); check RabbitMQ memory (`OOMKilled`). |
| Many students get 403 from Safe Exam Browser checks under load | The authorization service is saturated; add replicas and check the authorization database for slow queries. |
| Students cannot sign in during a lab burst | Per-address rate limit (section 5), or too few identity replicas. |
| `migrate` fails on upgrade | Read `docker compose logs migrate`; do not start services against a half-migrated database; restore the backup if needed. |
| Disk full | Build caches and logs first (`docker system prune` removes unused images and build cache only); never delete database volumes. |
