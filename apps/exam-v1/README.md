# AetherCode Exam (v1)

A single-server coding-exam app: admins import students from CSV, faculty author
questions and schedule exams, and students solve them in a HackerRank-style
editor with **Run** (sample tests) and **Submit** (all tests). A background
worker grades code through Judge0 (or Piston).

This is the lean first version described in
[ADR-0016](../../docs/adr/0016-lean-exam-app-for-first-launch.md). It runs
alongside the AetherCode microservices, which remain the long-term platform.

## How it works

| Piece | What it does |
|---|---|
| `app/` | Next.js App Router UI and API routes. Server components query Postgres directly. |
| `worker/main.ts` | Claims queued submissions (`FOR UPDATE SKIP LOCKED`), runs each test through the engine, stores per-test verdicts. Also auto-submits each student's latest draft when their attempt ends. |
| `lib/engine.ts` | Engine adapters. `Judge0Engine` (production) and `PistonEngine` (local dev / cgroup v2 hosts). Add your own engine by implementing `Engine.execute`. |
| `lib/grade.ts` | With Judge0, compiles once per group (samples, hidden) and runs every test in that one job (`lib/batch.ts`). Otherwise runs the first test alone (so a compile error costs one call) and fans the rest out. Picks the worst verdict, sums passed weight. |
| `lib/batch.ts` | Builds the compile-once job: source, a `compile` script, a `run` script that executes each input under its own CPU limit, and framed base64 output per test. Samples and hidden tests never share a job, so a program cannot read hidden inputs while its output is shown to the student. |
| `db/*.sql` | Schema, applied in order by `pnpm migrate`. |

### Rules

- **Roles:** `admin` (people + everything faculty can do), `faculty` (questions, exams, results), `student`.
- **Sign-in:** username/roll number + password. A student signing in elsewhere ends their other session. Five failed attempts lock that username for a minute.
- **Timing:** each student's clock starts when they click Start: deadline = min(start + duration, window close). The server is the source of truth; the browser clock is anchored to server time.
- **Scoring:** a question's score is its *best* submission: `points × passed weight ÷ total weight`. Every test (sample and hidden) counts by weight.
- **Time-up:** the browser saves the last edits (drafts are accepted for 15 s after the deadline), then the worker submits each question's latest draft unless that exact code was already submitted.
- **Visibility:** students see full input/output for sample tests and only pass/fail for hidden tests.
- **Focus tracking:** leaving the exam window is logged and shown to faculty as "Focus lost".
- **Limits:** at most 2 queued runs per student at once; source ≤ 64 KB; Java and Python get 2× the time limit.
- **After students start**, an exam's question list is frozen; timing, batches and publishing stay editable. Faculty can grant extra minutes to one student from their attempt page, and regrade all submissions for a question after fixing a test case.

## Local development

```bash
docker run -d --name examv1-pg -e POSTGRES_USER=exam -e POSTGRES_PASSWORD=exam -e POSTGRES_DB=exam -p 55432:5432 postgres:17-alpine
cp .env.example .env          # point DATABASE_URL at port 55432, pick an engine
pnpm install
pnpm migrate
pnpm create-admin admin       # prints the admin password
pnpm dev                      # http://localhost:3000
pnpm worker                   # in a second terminal
```

Checks: `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm engine-check` (runs correct, wrong, slow and broken programs in every language through the configured engine).

## Deploying on the campus server

Requirements: Docker with the Compose plugin, and **cgroup v1** for Judge0 1.13
(see below). Size the server by CPU cores: Judge0 runs one test per core at a time.

```bash
cd apps/exam-v1/deploy
cp .env.example .env                    # set DB_PASSWORD
cp judge0.conf.example judge0.conf      # set both passwords; COUNT = CPU cores
docker compose up -d --build
docker compose exec app pnpm create-admin admin "Exam Admin"
docker compose exec worker pnpm engine-check   # must print "Engine OK"
```

Students and faculty open `http://<server-ip>/`. `COOKIE_SECURE=false` is
required while serving plain HTTP on the LAN; put the app behind HTTPS and set it
to `true` if it is ever exposed beyond the campus network.

### Judge0 needs cgroup v1

Judge0 1.13's sandbox (isolate) only works with cgroup v1. Check with
`stat -fc %T /sys/fs/cgroup`: `tmpfs` means v1 (good), `cgroup2fs` means v2.
On Ubuntu 22.04/24.04 switch to v1 by adding
`systemd.unified_cgroup_hierarchy=0` to `GRUB_CMDLINE_LINUX` in
`/etc/default/grub`, then `sudo update-grub && sudo reboot`. Distributions with
systemd ≥ 256 (e.g. Debian 13) cannot boot cgroup v1; there, run Piston instead,
which requires cgroup v2:

```bash
# in deploy/.env: ENGINE=piston and ENGINE_URL=http://piston:2000
docker compose --profile piston up -d --build
docker compose exec app pnpm piston-runtimes   # downloads gcc, python, java once
```

### Before the first graded exam

1. Import students, create one practice exam, and have a few students run it.
2. Run a load test that matches the expected number of students (`pnpm loadtest`, see below).
3. Hold a mock exam with real students in the lab.
4. Keep a fallback (extra time or a paper backup) for the first real exam.

### Operations

- **Watch grading:** `docker compose logs -f worker`.
- **Back up:** `docker compose exec db pg_dump -U exam exam > backup-$(date +%F-%H%M).sql`, before and after every exam.
- **Restart safely:** submissions a crashed worker was holding are reclaimed after 5 minutes; failed engine calls are retried 3 times, then marked as a system error that the student can resubmit.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | — | Postgres connection string. |
| `DATABASE_POOL_SIZE` | `20` | Connections per process. |
| `ENGINE` | `judge0` | `judge0` or `piston`. |
| `ENGINE_URL` | — | Engine base URL. |
| `ENGINE_AUTH_TOKEN` | empty | Judge0 `X-Auth-Token`, if configured. |
| `ENGINE_BATCH` | `true` | Judge0 only: compile once per submission and run all tests in one job (~5–8× less work). Set `false` to fall back to one Judge0 job per test if `engine-check` fails in batch mode. |
| `WORKER_CONCURRENCY` | `8` | Parallel engine calls from the worker. Judge0: about 2× `COUNT` (extra jobs wait in Judge0's queue). Piston: at most CPU cores − 2, because Piston times by wall clock and CPU contention causes false time-limit verdicts. |
| `COOKIE_SECURE` | `true` | Set `false` only for plain HTTP on a trusted LAN. |

## CSV format for students

```csv
roll_no,name,batch
22CS001,Asha Kumar,CSE-A
```

Header aliases: `username`/`roll no`/`register no`, `name`/`student name`,
`batch`/`section`/`class`. The whole file is rejected if any row is invalid, so
nothing is half-imported. Existing roll numbers are skipped. Generated passwords
are shown once, so download the credentials CSV right away.
