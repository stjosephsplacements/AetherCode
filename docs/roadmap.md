# Roadmap: Go platform exam parity

**Goal:** a college runs a full graded exam (CSV import → authoring → timed
exam → grading → results) on the Go microservices plus a `web/` frontend, with
every capability `apps/exam-v1` has. Then `apps/exam-v1` is deleted.

**Decision:** ADR-0017. **Reference implementation:**
- `apps/exam-v1`, whose README is the behavioural spec;
- `apps/exam-v1/e2e/exam-flow.spec.ts`, the acceptance test.

**Rules:**
- the root `CLAUDE.md` applies throughout;
- every phase ends green on `make build test lint test-integration`;
- a phase is not done until its slice of the e2e spec passes through the
  gateway.

## Execution order (2026-10-03): milestones on the critical path

Work in this order. Each milestone ends with something demonstrable, and the
phases below give the detail. M0–M5 are the minimum for a graded SEB exam on
the platform (≈10–12 focused days). Until M8, exams run on `apps/exam-v1`.

| # | Milestone | Done when | Status |
|---|---|---|---|
| M0 | Platform runs on one server | `deploy/single-server` brings up all 11 services, the judge stack and the engine healthy. An admin bootstraps and signs in through the gateway. | done (2026-10-03, campus server; engine was Piston, ADR-0018; now the AetherCode Execution Engine, ADR-0028) |
| M1 | Accounts | An admin creates a college and batch, bulk-imports students from CSV with generated passwords, creates staff, and anyone signs in by username or roll number. | done (2026-10-04, ADR-0019; `deploy/single-server/smoke.py`) |
| M2 | Authoring | Staff write a question with plaintext tests (bundles built and encrypted server-side), build an exam from it, and assign it to a batch. | done (2026-10-04, ADR-0020; `smoke.py`) |
| M3 | Take and grade | A student starts, saves code, runs samples and submits. Dispatch → judge (decrypt) → Judge0 → score. Time-up submits latest answers. | done (2026-10-05, ADR-0021; `smoke.py`) |
| M4 | SEB | Per-request SEB key validation that works with a real SEB browser, plus `.seb` launch-file download (ADR-0022). | Done 2026-10-05 |
| M5 | Frontend | `frontend/` ports the exam-app screens (login, admin, authoring, exam screen, results) onto the gateway. | done in code (2026-10-19, ADR-0023 to 0026); needs `smoke.py` on the campus stack |
| M6 | Results and operations | Faculty results/CSV, result release, live monitor, extend time, announcements, backups and system status. | done in code: results, CSV, release, monitor, extra time, announcements (ADR-0027) and a staff system status page; backups run every 15 minutes |
| M7 | Remaining parity | Pools, MCQ, network allow-list, preview, similarity, audit log, model-solution check, import/export, duplicate, login slips. | done in code: duplicate, preview, login slips, attempt review and audit log (ADR-0029), lab networks (ADR-0030), similarity (ADR-0031), export/import (ADR-0032), model-solution checks (ADR-0033), pools (ADR-0034) and multiple choice (ADR-0035) |
| M8 | Cut-over | The ported e2e spec, `engine-check` and a 1000-student load test pass on the stack. `apps/exam-v1` is deleted. | `engine-check` passes on the campus stack (2026-10-20); the load tool is written (`make loadtest`), not yet run; e2e spec to port |

Already done (2026-10-03):
- audit fixes A4, A11 and B1;
- the go.sum completeness fix (images build);
- the move into `backend/`;
- M0 on the campus server, which surfaced and fixed the bugs listed in the
  audit's fix log (NATS stream, event payload hashing, bootstrap, reset).

Done 2026-10-04, each verified end to end through the gateway at
the campus deployment by `deploy/single-server/smoke.py`:
- M1 accounts (ADR-0019), and Identity's principal endpoints restricted to
  the caller (any user could delete any account);
- M2 authoring: D1 staff authoring (ADR-0020), server-built encrypted test
  bundles with weights (`libs/pkg/evalbundle`), exam items resolved from the
  bank over the internal gRPC contract, and batch assignment that actually
  reaches students (candidate = principal; roster from the versioned batch
  snapshot);
- platform bugs found on the way: gateway rejected browser/nginx requests
  (hop-by-hop headers); tenant lists sent an empty resource ID; projection
  workers lacked grants in assessment (schema, inbox) and analytics (RLS read
  for ON CONFLICT); authorization projection lag returned 500 (now 503 with
  Retry-After); audit log recorded the gateway's address;
- operations: backups every 15 minutes with a verified restore, the public
  domain behind Cloudflare → tunnel → nginx with the gateway on loopback, and
  key-only SSH for the deploy account.

Done 2026-10-05, verified end to end through the gateway by `smoke.py`:
- M3 take and grade. Per-candidate deadline = min(start + duration, window
  close); answers accepted 15 s past it; time-up submits the latest saved
  answers and they are graded (the deadline had been the window's close, and
  expiry graded nothing). Run against sample tests shows input, expected and
  actual output (ADR-0021): sample bundles are marked, Judge stores encrypted
  per-test output only for them, Submission routes completions by job.
- Bug found on the way: time-up minted version 4 evaluation request ids, which
  Judge rejects as correlation ids (fixed in submission 000025).
- Not in M3: per-question submit with best score (the platform grades one
  whole-attempt submit), custom-input runs, and purging old runs.
- M4 SEB (ADR-0022). Staff lock an exam with the Browser Exam Keys / Config
  Keys SEB reports; while a candidate's locked exam is open, Gateway sends
  every Submission request's URL and SEB headers to SEB, which accepts only
  sha256(URL + accepted key). Candidates download the exam app's `.seb`
  launch file. The old design required custom headers real SEB never sends.
- Bugs found on the way: SEB's lifecycle projection decoded real events
  strictly and its role lacked USAGE on schema `seb`, so it never applied an
  event (fixed in seb 000013; new durables back-filled 56 assignments). The
  exam app's SEB check was never called, and its download route read a
  missing column; only its launch-file encoding was reused.
- Not in M4: SEB quit-token sessions stay as they were (not on Gateway's
  path); a frontend `/exam/<id>` page for the launch file to open is M5.

Done 2026-10-19 (code; integration-tested, not yet on the campus stack):
- M5 web frontend (`frontend/`, ADR-0024): students sign in, see their exams,
  take them in a HackerRank-style screen with Run, custom input, per-question
  Submit and End test (ADR-0025, best submission counts); staff import
  students, author questions, build, publish and assign exams, lock them to
  SEB, and see results with CSV export.
- Backend gaps found on the way: no candidate paper or saved-code read, no
  "who am I", no exam title on assignments (ADR-0023); exams assigned to a
  placement department reached nobody (ADR-0026); no draft-question list or
  exam-content read for staff; exam results capped at 500 rows.

Done 2026-10-20, deployed and verified by `smoke.py` on the campus stack:
practice problems (ADR-0041). Staff mark questions for tests
or practice; students get a practice catalogue, a run/submit workspace and a
My progress page; exams offer test questions only.

Done 2026-10-20, deployed with SSO switched off: single sign-on through the
college's ZITADEL (ADR-0042), tested against a real ZITADEL. It goes live
once ZITADEL's argon2 verifier, an OIDC app and a service-user token are in
place (`deploy/single-server/README.md`, "Single sign-on").


Done 2026-10-21 in code, tested on the campus server's scratch checkout and
pushed, **not yet deployed**:
- M8 tooling: `make engine-check` (Engine OK on the campus stack),
  `make loadtest` (written, not yet run at 1000 students), and v1's browser
  spec ported (`pnpm e2e`, Playwright 1.63.0).
- Staff operations (ADR-0043): analytics page, grading queue on System
  status, audit log of staff actions, staff list with a roles editor and bulk
  mentor assignment.
- Fix: the exam list carries each exam's latest version (assessment
  `000033`), so the staff exams page no longer exceeds the per-user rate limit.

Also done 2026-10-21 in code, tested against a scratch PostgreSQL 16 and the
frontend build, **not yet deployed or run on the campus stack**:
- Staff exam calendar (`/staff/calendar`).
- Question review before use (ADR-0044): question-bank `000019`,
  `QBANK_REQUIRE_REVIEW` (off by default), "To review" queue.
- Per-college name, colour and logo from a mounted file (ADR-0045).
- A coding question publishes only after a model solution passes every test
  (ADR-0047, question-bank `000020`); integration-tested on PostgreSQL 16.
- Community content (ADR-0048): interview experiences with staff approval,
  blogs, contest/hackathon/open-source listings with bookmarks and Codeforces
  and GitHub imports, linked coding accounts with public stats, personal tasks.
  notification `000013`, user `000030`; unit- and integration-tested on
  PostgreSQL 16 only.
- A colleges screen for platform administrators, and naming a reviewer on a
  question review request (question-bank `000021`).
- Staff try an exam as a student in a private copy (ADR-0046); the
  `smoke.py` check for it has not been run.

### Pending (2026-10-21)

Needs the owner:
1. Cloudflare: the public `aethercode.stjosephsplacements.in` still routes to
   v1, and `exam.stjosephsplacements.in` has no public hostname. Point
   `aethercode.` at the campus tunnel (nginx :80) and add `exam.` for v1.
2. Deploy the 2026-10-21 batch: user `000029`, submission `000035`,
   assessment `000033`, question-bank `000019` to `000021`, notification
   `000013`, user `000030`; rebuild identity, user,
   submission, assessment, question-bank and frontend; back up first and run
   `smoke.py`. Optionally set `QBANK_REQUIRE_REVIEW=true`.
3. Single sign-on (ADR-0042): approve ZITADEL's argon2 verifier, create the
   OIDC app and the service-user token, then set `IDENTITY_SSO_*` and
   `AETHERCODE_SSO=on`.
4. v1's FAQ page publishes the Safe Exam Browser quit password; remove it or
   change the password.
5. Monitoring and alerts, deploys from CI, off-server backups (credentials
   and a destination needed).

Still to build:
- Rerun `pnpm e2e` after the exam-list fix (it stopped at the teacher's
  release step on the rate limit) and run `make loadtest` at 1000 students.

---

## Phase 0: Run the platform on one server (≈3 days)

Today the platform deploys only to Kubernetes (3-node Postgres, mTLS,
RabbitMQ). The campus server needs one machine.

1. `deploy/single-server/`: a Docker Compose stack with:
   - all 11 services;
   - Postgres (one instance, every service database), NATS, MinIO;
   - the judge control plane (its own Postgres + RabbitMQ) and Judge0.

   A script generates a local CA and the mTLS certificates for each service.
   A one-shot provisioner creates roles and runs every migration with its
   migrator. Bootstrap uses `make bootstrap`.
2. Fix the known breakers that block a single exam:
   - `extensions.uuid_generate_v7()` is called but never defined (assessment
     000010/000011);
   - judge-control Helm/env names don't match the Go config
     (`JUDGE0_BASE_URL`, `JUDGE0_AUTH_TOKEN`, `JUDGE_ENGINE`);
   - analytics' `judge.completed.v1` decoder lacks `completed_at`, so every
     event is rejected;
   - `hardDeleteAttempt` authorizes the action `delete`, which the authz
     layer rejects.
3. Smoke test: bootstrap → log in through the gateway → create a tenant,
   department and batch.

## Phase 1: Close the grading loop (≈4 days)

1. **Question Bank: server-side test upload.** A new endpoint takes
   plaintext tests (inputs, outputs, sample flag, weight). The service:
   - builds the ADR-0014 evaluation bundles;
   - encrypts them with KMS and stores them in MinIO;
   - records the sample and hidden manifests.

   Clients never handle object keys.
2. **Assessment ↔ Question Bank.** Exam items reference a published question
   version. Assessment resolves bundle references through an internal gRPC
   contract instead of caller-supplied keys. This changes the
   `addExamItem` contract.
3. **Submission: raw source.** Answer and run endpoints accept source text and
   encrypt and store it server-side (Task 3 wiring already exists).
4. **Dispatch.** A consumer of `submission.evaluation_requested.v1` calls
   judge `SubmitExecution` over mTLS.
5. **Judge.** Fix decrypt-before-dispatch in `FetchQueuedJob`, and add
   compile-once batching (port `apps/exam-v1/lib/batch.ts`).
6. **Run code.** Plan D Tasks 4–7: run endpoint, status/history, purge
   worker, integration test.
7. **Time-up.** The expiry worker submits the latest answer per item.
8. **Acceptance.** An integration test runs submit → judge → completion →
   score, with real Judge0 locally (`make dev-judge-up`).

## Phase 2: Accounts and organisation (≈2 days)

1. Identity: admin-created principals with generated passwords, without email
   verification (an admin action, audited), and sign-in by username/roll
   number.
2. User: bulk import of students into a batch (CSV rows → principals,
   profiles, affiliations), password reissue for a batch, enable/disable.
3. Authorization: faculty and college-admin roles mapped onto the medallion
   model (see decision D1).

## Phase 3: `web/` frontend (≈4 days)

1. Move the exam-app screens into `web/` (Next.js 16):
   - landing, login, admin, faculty, the exam screen, results.
2. The Next.js server is a thin backend-for-frontend:
   - it keeps platform tokens in httpOnly cookies and calls the gateway;
   - it has no database and no grading.
3. Port `e2e/exam-flow.spec.ts` to `web/` against the gateway.

## Phase 4: Exam feature parity (≈5–7 days)

Ported one at a time. Each feature lands with its migration, authorization
policy, contract, events and service README:

| Feature | Owner service |
|---|---|
| Question pools (slots), random draw at start | assessment, submission |
| Multiple choice | question-bank, assessment, submission |
| Model-solution check | question-bank → judge |
| Test import (zip), question export/import, duplicate exam | question-bank, assessment |
| Lab lockdown: network allow-list, fullscreen/paste flags, flags log | assessment, gateway, submission |
| Extend one / everyone, end exam, auto-submit | submission |
| Announcements | notification (in-app) |
| Live monitor, results, CSV export, result release | analytics, submission |
| Similarity report | analytics (or new read model) |
| Preview as student | submission (preview attempts) |
| Audit log of staff actions | new `audit` read model fed by events |
| Login slips, system status, backups | web, deploy |

## Phase 5: Cut-over (≈1–2 days)

1. The ported e2e spec, `engine-check` and a 1000-student load test pass
   against the single-server stack.
2. Delete `apps/exam-v1` and its `make exam-*` targets; update the root docs
   and ADR-0016's status.

---

## Decisions (2026-10-02)

- **D1, authoring:** anyone on staff can author questions. They go into the
  single master (global) question bank, which every college uses. Students
  can't author. This replaces `docs/PLAN.md`'s Golden-only rule and needs an ADR and
  a policy change in Phase 2.
- **D2, deployment:** Docker Compose on one server (Phase 0).
- **D3, SEB:** **required** for exams. The platform's SEB enforcement
  (gateway + `seb` service) must work end to end, and lab PCs need SEB
  installed with the exam's configuration. It moves into Phase 1 scope.
- **D4, Judge0 gate:** approved for the campus server with `engine-check`
  evidence recorded per the compatibility-gate runbook.

## Timeline risk

The total is ≈19–22 working days; the first exam is in 1–2 weeks. Exams before
Phase 5 run on the frozen `apps/exam-v1`.

## Production gates outside the repository

These need an approved external system, credential, environment or exercise;
the backend stays fail-closed until each has evidence.

- **India-resident platform HA deployment:** provision three independently
  powered PostgreSQL nodes, encrypted India-resident WAL/base-backup storage,
  client certificates, and the separate Judge control-plane HA and RabbitMQ
  quorum clusters. Run the documented node-loss and PITR restore exercises.
- **KMS and object storage:** approve and configure an India-resident KMS/key
  controller plus encrypted object storage for source, hidden tests, SEB
  configuration, large outputs, and analytics exports. Supply scoped workload
  identities; do not add plaintext or local fake adapters.
- **Notification provider:** approve a provider, India-resident recipient-data
  path, encrypted address resolver, provider credentials, retention terms, and
  delivery observability before email or SMS is enabled.
- **Judge0 security gate:** prove the pinned upstream image under gVisor with
  non-root/read-only execution, no privilege escalation, no host mounts or
  Docker socket, and deny-by-default/no user-controlled networking. The result
  must be recorded by the compatibility-gate runbook before an engine
  dispatcher or submission-admission adapter is enabled.
- **Production performance and continuity evidence:** execute the 10,000
  candidates/five-minute load profile against the approved engine and real
  question suite; demonstrate submission P95 ≤2 seconds and final-verdict P95
  ≤60 seconds. Exercise PostgreSQL, RabbitMQ, Judge worker, and wrapper-node
  loss with durable queue replay and no lost work.
- **Secrets and security approval:** provision and rotate real authorization
  HMAC material, mTLS issuers, database client certificates, image-signing
  keys, monitoring/alerting destinations, and complete the ASVS, SEB, and Judge
  sandbox security reviews.
