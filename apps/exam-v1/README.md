# AetherCode Exam (v1)

A single-server coding-exam app for running graded programming exams in a
supervised college lab:
- **Admins** import students from CSV and print login slips.
- **Faculty** author questions, schedule exams and watch them live.
- **Students** solve problems in a HackerRank-style editor, using **Run**
  (sample tests) and **Submit** (all tests).

A background worker grades code through Judge0 or Piston.

This is the lean first version described in
[ADR-0016](../../docs/adr/0016-lean-exam-app-for-first-launch.md). It is
independent of the AetherCode microservices in this repository (no shared code
or database). Those remain the long-term multi-college platform.

## Features

| Role | What they can do |
|---|---|
| **Admin** (`/admin`) | Import students from CSV with generated passwords; download credentials or print cut-out login slips; reissue passwords for a whole batch; create faculty/admin accounts; reset one password; enable/disable users; see system health at `/admin/system` and every staff action at `/admin/audit`. Admins can do everything faculty can. |
| **Faculty** (`/faculty`) | Write questions in Markdown with sample and hidden tests (typed or imported from files/zip), and **verify them against a model solution**; build exams for batches with a time window, per-student duration, languages, **question pools** and **lab lockdown**; watch the **live monitor**; post **announcements**; grant extra time to one student or **everyone at once**; view any student's code, submissions and flags; **regrade** after fixing a test; export results as CSV; **release results**; open the **similarity report**. |
| **Student** (`/student`, `/exam/[id]`) | See exams for their batch; start once the window opens; solve in C, C++, Java or Python with Run, custom input and Submit; see per-test results (hidden tests as pass/fail only); after release, see their score breakdown. |

## How it works

| Piece | What it does |
|---|---|
| `app/` | Next.js 16 App Router. Server components query Postgres directly; form mutations are server actions (`actions.ts` beside each page); the exam screen polls small JSON routes under `app/api/`. |
| `app/exam/[examId]/exam-ide.tsx` | The exam screen: problem pane, CodeMirror editor, results/custom-input console, timer, autosave, fullscreen gate, paste guard, announcements. |
| `worker/main.ts` | Claims queued submissions (`FOR UPDATE SKIP LOCKED`, runs before submits), grades them, stores per-test results; retries failed engine calls 3×; reclaims work from crashed workers after 5 min; auto-submits final drafts when attempts end; writes a heartbeat every 5 s. |
| `lib/engine.ts` | Engine adapters. `Judge0Engine` (production, with compile-once batching) and `PistonEngine` (local dev / cgroup v2 hosts). Add an engine by implementing `Engine.execute` (and optionally `executeBatch`). |
| `lib/grade.ts` | Turns engine results into verdicts and scores: batched per test group when the engine supports it, otherwise per test with a compile-error short-circuit. Picks the worst verdict, sums passed weight. |
| `lib/batch.ts` | Builds the compile-once job for Judge0's multi-file mode: source, a `compile` script, a `run` script that runs each input under its own CPU limit, and framed base64 output per test. Also a minimal ZIP writer. |
| `lib/compare.ts` | Output comparison: ignores trailing spaces per line, trailing blank lines and CRLF. |
| `lib/attempts.ts`, `lib/net.ts`, `lib/client-ip.ts` | Student API guards: session, attempt ownership, deadline (with draft grace), IPv4 network allow-list. |
| `lib/results.ts` | Per-slot scores for the results table and CSV export. |
| `lib/similarity.ts`, `lib/similarity-report.ts` | MOSS-style winnowing over a normalized token stream; per-slot suspicious pairs. |
| `lib/test-files.ts` | Pairs uploaded test files and reads ZIPs in the browser. |
| `lib/health.ts` | Database, worker-heartbeat, engine and queue checks for `/api/health` and `/admin/system`. |
| `db/NNN_*.sql` | Schema migrations, applied in order by `pnpm migrate` and recorded in `schema_migrations`. |
| `scripts/` | `migrate`, `create-admin`, `engine-check`, `loadtest`, `install-piston-runtimes`. |
| `deploy/` | Docker Compose: `nginx` (only published port), `app`, `worker`, `migrate`, `db`, `backup`, Judge0 (`judge0-server`, `judge0-workers`, `judge0-db`, `judge0-redis`), optional `piston`. |

### Data model

| Table | Holds |
|---|---|
| `users`, `sessions` | Accounts (`admin`/`faculty`/`student`, batch) and hashed session tokens. Passwords are scrypt hashes. |
| `questions`, `test_cases` | Problem statement, limits, and ordered tests (`is_sample`, `weight`). |
| `exams`, `exam_questions` | Window, duration, languages, batches, lockdown settings, `results_released`; questions grouped into `slot`s (pools). |
| `attempts`, `attempt_questions` | One attempt per student per exam with its deadline; the question drawn for each slot. |
| `drafts` | Latest autosaved code per attempt and question. |
| `submissions`, `submission_results` | Runs and submits, their status and score inputs, and per-test verdicts/output. |
| `attempt_events` | Flags: window blur, fullscreen exit, blocked paste. |
| `announcements` | Faculty messages per exam. |
| `audit_log` | Append-only staff actions (who, what, target, details); rows outlive deleted accounts. |
| `worker_heartbeats` | Liveness of each grading worker. |

## Rules

- **Roles:** `admin` (people + everything faculty can do), `faculty` (questions, exams, results), `student`. Every page, server action and API route checks the role on the server.
- **Sign-in:** username/roll number + password, case-insensitive (usernames are unique ignoring case). A student signing in elsewhere ends their other session. Five failed attempts lock that username for a minute. Unknown usernames cost the same time as wrong passwords, so accounts can't be discovered by timing. Sessions last 12 hours.
- **CSV exports are spreadsheet-safe:** cells starting with `=`, `+`, `-` or `@` are prefixed with `'` so they can't run as formulas.
- **Timing:** each student's clock starts when they click Start: deadline = min(start + duration, window close). The server is the source of truth; the browser clock is anchored to server time.
- **Question pools:** an exam question can have alternatives. Each student is assigned one question per slot at random when they click Start; results and exports are by slot (Q1, Q2…), so everyone is graded on the same scale. Alternatives in a pool must be worth the same points.
- **Scoring:** a question's score is its *best* submission: `points × passed weight ÷ total weight`. Every test (sample and hidden) counts by weight.
- **Time-up:** the browser saves the last edits (drafts are accepted for 15 s after the deadline), then the worker submits each question's latest draft unless that exact code was already submitted.
- **Visibility:** students see full input/output for sample tests and only pass/fail for hidden tests. In batch grading, samples and hidden tests run in separate jobs so a program can never read hidden inputs while its output is shown.
- **Lab lockdown (per exam):** an IPv4 allow-list of lab networks (checked when starting and on every exam request), an optional fullscreen gate, and optional blocking of pastes and drag-and-drop text that did not come from the student's own editor. Window switches, fullscreen exits and blocked pastes are logged and shown to faculty as **Flags**.
- **Network check needs nginx:** the allow-list trusts `X-Forwarded-For`, which `deploy/nginx.conf` overwrites with the real client address. Never publish the `app` container's port directly. The exam settings page shows "Your IP as seen by the server": confirm it shows a lab address before relying on the allow-list.
- **Similarity report:**
  - Per question slot, it compares every student's final code (latest submission, else draft).
  - It uses MOSS-style winnowing over a token stream that ignores names, literals, comments and layout.
  - Code shared by more than half the class (capped at 50 students) is ignored as boilerplate.
  - Pairs scoring ≥ 60% are listed with a side-by-side view. A score is a reason to look, not proof.
- **Audit log:** every staff change is recorded with actor, action, target and details:
  - imports, staff accounts, password resets and batch reissues, enabling and disabling users;
  - creating and editing questions and exams, and regrades;
  - extra time for one student or everyone, announcements, and releasing or hiding results.

  Admins search it at `/admin/audit`. Model-solution checks and the student's own actions are not staff changes and are not logged there.
- **Announcements:** faculty post from the live monitor; every student in that exam sees a banner within ~15 s and the full list above the problem.
- **Result release:** students see nothing but "submitted" until faculty click *Release results*; then they see their total, per-question scores and per-test verdicts (hidden tests by number only).
- **Limits:**
  - at most 2 queued runs per student at once;
  - source ≤ 64 KB;
  - expected output ≤ 256 KB per test;
  - Java and Python get 2× the time limit.
- **Model solution:**
  - On the question editor, faculty can paste a solution and run it against the current (even unsaved) tests through the real engine.
  - Mismatched expected outputs are shown side by side and can be replaced with the solution's output in one click. Leaving outputs blank and adopting them is a quick way to generate them.
  - A warning appears if the solution uses over half the time limit.
  - The solution is stored with the question (`reference_language`, `reference_source`) and is never sent to students.
- **Extend everyone:** the live monitor can add N minutes to every attempt still in progress and push the exam window back by the same amount. Optionally it reopens attempts the clock ended in the last 30 minutes, never ones a student ended themselves. Use it after a lab-wide outage.
- **After students start:**
  - an exam's question list is frozen; timing, batches, lockdown and publishing stay editable;
  - faculty can grant extra minutes to one student from their attempt page;
  - faculty can regrade all submissions for a question after fixing a test case.

## Students: CSV import and login slips

```csv
roll_no,name,batch
22CS001,Asha Kumar,CSE-A
```

Header aliases: `username`/`roll no`/`register no`, `name`/`student name`,
`batch`/`section`/`class`. The whole file is rejected if any row is invalid, so
nothing is half-imported. Existing roll numbers are skipped.

Generated passwords are shown **once**. Right after import, either:
- **Download CSV**, or
- **Print login slips**: 21 cut-out cards per A4 page with name, batch,
  username, password and the site address.

If slips are lost, **Reissue a batch** gives every student in that batch a new
password, signs them out, and lets you print a fresh set.

## Questions: importing test cases

On the question editor, **Import files / .zip** accepts a ZIP or many files.
Supported naming schemes:
- `input/input00.txt` + `output/output00.txt` (HackerRank export);
- `1.in` + `1.out` (or `.ans`);
- `input1.txt` + `output1.txt`.

Files are paired by number. If the question has no sample yet, the first
imported test becomes the sample. Unpaired files are listed as skipped. Inputs
over 20 KB show as a size summary instead of a text box.

## Local development

```bash
docker run -d --name examv1-pg -e POSTGRES_USER=exam -e POSTGRES_PASSWORD=exam -e POSTGRES_DB=exam -p 55432:5432 postgres:17-alpine
cp .env.example .env          # DATABASE_URL on port 55432; ENGINE/ENGINE_URL below
pnpm install
pnpm migrate
pnpm create-admin admin       # prints the admin password
pnpm dev                      # http://localhost:3000
pnpm worker                   # in a second terminal
```

For a local engine, Piston is easiest. It needs cgroup v2, which most modern
desktops have:

```bash
docker run -d --privileged --name examv1-piston -p 2000:2000 \
  -e PISTON_RUN_TIMEOUT=40000 -e PISTON_COMPILE_TIMEOUT=20000 -e PISTON_OUTPUT_MAX_SIZE=1048576 \
  -v "$HOME/.cache/examv1-piston:/piston/packages" ghcr.io/engineer-man/piston
ENGINE_URL=http://localhost:2000 pnpm piston-runtimes   # gcc, python, java (~1 GB, once)
# .env: ENGINE=piston  ENGINE_URL=http://localhost:2000  WORKER_CONCURRENCY=<cores - 2>
```

Checks:
- `make exam-check` (typecheck + unit tests) and `make exam-build` from the repo root;
- `pnpm engine-check`, which runs correct, wrong, infinite-loop and broken programs in
  every language through the configured engine and must print "Engine OK".

### End-to-end test

`e2e/exam-flow.spec.ts` drives a real browser through the whole flow:
1. Admin imports students and creates a faculty account.
2. Faculty write a question and publish an exam.
3. A student gets a wrong Run, then an accepted Submit, and ends the exam.
4. A second student's unsubmitted draft is auto-submitted at time-up.
5. Faculty check scores, release results and export the CSV.
6. The student sees their released score.

It needs the app, the worker and an engine running against `DATABASE_URL`. It
creates uniquely named data and deletes it afterwards.

```bash
npx playwright install chromium        # once; or set E2E_BROWSER_CHANNEL=chrome to use installed Chrome
E2E_BASE_URL=http://localhost:3000 pnpm e2e
```

Run it before every release and before each exam season.

`next dev` hot-reloads the exam screen while you edit it and resets its state
when hooks change, so test timing and exam-ending behaviour against
`pnpm build && pnpm start`. If the Playwright browser window is visible, don't
click in it during automated tests: the server logs can't tell your clicks
from the test's.

## Deploying on the campus server

Requirements:
- Docker with the Compose plugin;
- **cgroup v1** for Judge0 1.13 (see below);
- enough CPU: size the server by cores, because Judge0 runs one job per worker
  (`COUNT`) at a time.

```bash
cd apps/exam-v1/deploy
cp .env.example .env                    # set DB_PASSWORD
cp judge0.conf.example judge0.conf      # set both passwords; COUNT = CPU cores
docker compose up -d --build            # or `make exam-up` from the repo root
docker compose exec app pnpm create-admin admin "Exam Admin"
docker compose exec worker pnpm engine-check   # must print "Engine OK"
```

Students and faculty open `http://<server-ip>/` (nginx on `APP_PORT`, default 80).

| `deploy/.env` | Default | Meaning |
|---|---|---|
| `DB_PASSWORD` | — | Password for the exam Postgres (required). |
| `APP_PORT` | `80` | Port nginx listens on. |
| `COOKIE_SECURE` | `false` | Plain HTTP on the LAN needs `false`; set `true` behind HTTPS. |
| `WORKER_CONCURRENCY` | `16` | See Configuration below. |
| `ENGINE`, `ENGINE_URL` | `judge0`, `http://judge0-server:2358` | Switch to `piston`, `http://piston:2000` on cgroup v2 hosts. |
| `JUDGE0_AUTH_TOKEN` | empty | Judge0 `X-Auth-Token`, if set in `judge0.conf`. |
| `BACKUP_INTERVAL_MINUTES`, `BACKUP_RETENTION_DAYS` | `15`, `7` | Backup schedule and retention. |

### Judge0 needs cgroup v1

Judge0 1.13's sandbox (isolate) only works with cgroup v1. Check with
`stat -fc %T /sys/fs/cgroup`:
- `tmpfs` means v1, which is what you want;
- `cgroup2fs` means v2.

**Ubuntu 22.04/24.04:** switch to v1 by adding
`systemd.unified_cgroup_hierarchy=0` to `GRUB_CMDLINE_LINUX` in
`/etc/default/grub`, then run `sudo update-grub && sudo reboot`.

**systemd ≥ 256 (e.g. Debian 13):** these cannot boot cgroup v1. Run Piston
instead, which requires cgroup v2:

```bash
# in deploy/.env: ENGINE=piston and ENGINE_URL=http://piston:2000
docker compose --profile piston up -d --build
docker compose exec app pnpm piston-runtimes   # downloads gcc, python, java once
```

If `engine-check` fails only in Judge0 batch mode (for example a compiler path
differs in your Judge0 image), set `ENGINE_BATCH=false` for the `worker` and
restart it. Grading then uses one Judge0 job per test.

### Before the first graded exam

1. `engine-check` prints "Engine OK" on the server.
2. Import students, create one practice exam, and have a few students run it.
3. Load-test at the real student count (below) while watching `/admin/system`.
4. Hold a mock exam with real students in the lab. If you use the network
   allow-list, confirm the lab IP shown on the exam settings page.
5. Keep a fallback (extra time or a paper backup) for the first real exam.

### Load testing

```bash
docker compose exec worker pnpm loadtest --url http://nginx --students 1000 --ramp 120 --runs 3
docker compose exec worker pnpm loadtest --cleanup
```

The script creates its own batch (`LOADTEST`), question, exam and students
directly in the database, then simulates each student:
1. loads the exam page;
2. autosaves 3 times;
3. clicks Run `--runs` times;
4. submits once.

All four languages are used. It prints p50/p95 latency for page loads,
autosave, run → verdict and submit → verdict, plus any errors. `--cleanup`
removes everything it created.

### Operations

- **Watch grading:** `docker compose logs -f worker`, or `/admin/system` (waiting, grading, oldest wait, graded in the last 5 minutes). A warning appears if submissions wait over a minute.
- **Backups are automatic:** the `backup` service writes `deploy/backups/exam-YYYYMMDD-HHMM.dump` every 15 minutes and keeps 7 days. Copy the folder off the server after every exam. Check it with `docker compose logs backup`.
- **Restore** a dump: `docker compose exec -T db pg_restore -U exam -d exam --clean --if-exists < backups/exam-YYYYMMDD-HHMM.dump`.
- **Health:** `GET /api/health` returns `200` when database, worker and engine are up and `503` otherwise, for external monitors. It reveals nothing else.
- **Restart safely:** submissions a crashed worker was holding are reclaimed after 10 minutes (longer than the slowest Judge0 batch); failed engine calls are retried 3 times, then marked as a system error the student can resubmit.
- **A student's machine failed:** sign them in on another machine (their old session ends), then grant extra time from their attempt page. Their autosaved code is waiting.

## Configuration (app and worker)

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | — | Postgres connection string. |
| `DATABASE_POOL_SIZE` | `20` | Connections per process. |
| `ENGINE` | `judge0` | `judge0` or `piston`. |
| `ENGINE_URL` | — | Engine base URL. |
| `ENGINE_AUTH_TOKEN` | empty | Judge0 `X-Auth-Token`, if configured. |
| `ENGINE_BATCH` | `true` | Judge0 only: compile once per submission and run all tests in one job. Set `false` to fall back to one Judge0 job per test. |
| `WORKER_CONCURRENCY` | `8` | Parallel engine jobs from the worker. Judge0: about 2× `COUNT` (extra jobs wait in Judge0's queue). Piston: at most CPU cores − 2, because Piston times by wall clock and CPU contention causes false time-limit verdicts. |
| `COOKIE_SECURE` | `true` | Set `false` only for plain HTTP on a trusted LAN. |

## Known limitations

- **Single server.** One Postgres, one app and one worker; there is no failover.
  Backups are the recovery path.
- **IPv4 only.** The network allow-list matches IPv4 addresses only. A client
  reaching the server over IPv6 is blocked whenever an allow-list is set.
- **Untested outside Piston.** Judge0 batch mode and the Judge0 compiler paths
  in `lib/batch.ts` could not be run on the development machine (it uses cgroup
  v2). `engine-check` on the server is the verification.
- **Piston and Java.** Piston compiles Java inside the timed run; the adapter
  adds a 3 s allowance and maps `error: compilation failed` to a compile error.
- **No email.** Passwords are distributed on slips or CSV, not by email.
- **Regrading lowers scores briefly.** While a regrade runs, a question's re-queued submissions don't count, so totals can dip until the worker finishes.
- **Times show in IST.** Dates are formatted in `Asia/Kolkata` on the server.
- **One-process rate limit.** The login lockout counter lives in the app process, which is fine for one app container.
- **No proctoring.** There is no proctoring beyond lab lockdown and flags, and
  SEB is not used.
