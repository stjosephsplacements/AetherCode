# Go Platform Exam Parity Plan

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
| M0 | Platform runs on one server | `deploy/single-server` brings up all 11 services, the judge stack and the engine healthy. An admin bootstraps and signs in through the gateway. | done (2026-10-03, campus server; engine is Piston, ADR-0018) |
| M1 | Accounts | An admin creates a college and batch, bulk-imports students from CSV with generated passwords, creates staff, and anyone signs in by username or roll number. | done (2026-10-04, ADR-0019; `deploy/single-server/smoke.py`) |
| M2 | Authoring | Staff write a question with plaintext tests (bundles built and encrypted server-side), build an exam from it, and assign it to a batch. | done (2026-10-04, ADR-0020; `smoke.py`) |
| M3 | Take and grade | A student starts, saves code, runs samples and submits. Dispatch → judge (decrypt) → Judge0 → score. Time-up submits latest answers. | done (2026-10-05, ADR-0021; `smoke.py`) |
| M4 | SEB | Per-request config-key validation that works with a real SEB browser, plus `.seb` configuration generation and download. Known bug: SEB's lifecycle projection decodes `assessment.candidate_assignment.snapshot.v1` and `submission.attempt_submitted.v1` strictly into 4-field structs, so it rejects every real event and never closes a session on submit or revocation. | — |
| M5 | Frontend | `frontend/` ports the exam-app screens (login, admin, authoring, exam screen, results) onto the gateway. | — |
| M6 | Results and operations | Faculty results/CSV, result release, live monitor, extend time, announcements, backups and system status. | — |
| M7 | Remaining parity | Pools, MCQ, network allow-list, preview, similarity, audit log, model-solution check, import/export, duplicate, login slips. | — |
| M8 | Cut-over | The ported e2e spec, `engine-check` and a 1000-student load test pass on the stack. `apps/exam-v1` is deleted. | — |

Already done (2026-10-03):
- audit fixes A4, A11 and B1;
- the go.sum completeness fix (images build);
- the move into `backend/`;
- M0 on the campus server, which surfaced and fixed the bugs listed in the
  audit's fix log (NATS stream, event payload hashing, bootstrap, reset).

Done 2026-10-04, each verified end to end through the gateway at
https://aethercode.stjosephsplacements.in by `deploy/single-server/smoke.py`:
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
  can't author. This replaces `PLAN.md`'s Golden-only rule and needs an ADR and
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
