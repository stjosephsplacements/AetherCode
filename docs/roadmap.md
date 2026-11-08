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
| M3 | Take and grade | A student starts, saves code, runs samples and submits. Dispatch → judge (decrypt) → execution engine → score. Time-up submits latest answers. | done (2026-10-05, ADR-0021; `smoke.py`) |
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

Done 2026-11-05 to 2026-11-08 (code; deployed to `aether-test`):
- Security and correctness fixes from the ultrareview (PRs #137–#167); see
  `PENDING.md` §1 for the full list.
- RBAC overwrite wiring (ADR-0075): `rbac.Compute` is the live bitset
  decision path, `PUT /role-overwrites` rejects no-op rules, full branch
  coverage. Ready for `AUTHZ_ENGINE=shadow` observation then `=bitset`
  cutover.
- Down migrations from `node_scoped_capability_chain` restore each service's
  exact prior `set_context` body (9 files fixed).
- Browser tests: exam authoring wizard, extra time from the monitor, MFA
  step-up dialog, MCQ wizard, roster CSV export, practice mode.
- Roles management UI (`/staff/roles`): lists college roles sorted by tier,
  shows permission grids, create/edit/delete for non-managed roles (wired to
  the ADR-0066 CRUD endpoints).
- Build version injection: `libs/pkg/buildinfo` package with `-ldflags`
  injection in all 11 Dockerfiles, `Makefile` and `dev-sync.sh`; `/healthz`
  returns `{"version":"…"}` for deployed-version verification.
- `govet` shadow analyzer enabled with err-exclusion; gateway `route` variable
  rename fixes the one real non-err shadow.
- `AUTHZ_ENGINE` promoted from `kubectl` manual set to helm values and
  docker-compose for reproducible deployments.
- Gateway HTTP transport tuned: `MaxIdleConnsPerHost=20`, `MaxConnsPerHost=40`,
  `IdleConnTimeout=90s` to eliminate connection churn under load.
- Database pool metrics wired to all 11 services via `telemetry/dbmetrics`.
- Landing page and login page Liquid Glass redesign.
- JSON logging fix: `slog.SetDefault(logger)` in `logging.New()` so
  package-level `slog.Error`/`slog.Warn` calls emit JSON, not text format.
- NATS unlimited reconnection (`MaxReconnects(-1)`) prevents permanent
  consumer death after extended broker maintenance.
- Identity UTF-8 truncation fix: `truncate()` now respects rune boundaries,
  preventing PostgreSQL `text` column rejections on multibyte user-agents.
- Question-bank `listTags` HTTP adapter validates limit bounds (1–500) at the
  handler, matching the app-layer cap.
- `make check` convenience target: runs `build lint test web-check web-build`
  in one command for pre-push validation.
- Production readiness audit of: pagination library (keyset cursors, fixed-width
  timestamps), outbox publisher (SKIP LOCKED leasing, NATS dedup, exponential
  backoff), NATS consumer failure taxonomy, authz projection resync protocol,
  submission expiry worker, identity auth lifecycle, and graceful shutdown
  ordering.
- Extended production readiness audit confirming: gateway config validation
  (fail-closed, strict URL/CIDR/prefix validation, public service allowlist),
  model-check runner (bounded resource caps, output checksum, graceful output
  degradation), analytics projection (inbox dedup, temporal ordering, legal hold
  awareness, `messaging.Permanent` error taxonomy), community content adapter
  (DB-layer limit clamping, path-value override, RLS via `WithTenantTx`), tenant
  service (keyset pagination, retention policy bounds, legal hold scope
  validation, mandatory deletion reason), SEB lockdown (IPv4/v6 unmap for CIDR
  match, URL fragment rejection, key deduplication), and identity auth
  (hash-only token storage, refresh family rotation, MFA step-up, lockout
  protection). All subsystems confirmed production-ready; `make build lint test`
  and `make web-check` pass clean.
- Comprehensive deep-audit of all remaining backend services (2026-11-08):
  question-bank (three-bundle test architecture encrypt-then-SHA256, idempotency
  fingerprint excludes server-generated UUIDs, function-only composition
  Prefix+source+Suffix, `readSealed` checksum-then-decrypt, practice run vs
  submit mode, `context.WithoutCancel` cleanup to prevent ciphertext leak);
  submission (candidate source encrypted before transaction opens, `SubmitAttempt`
  idempotent replay on re-submit, evaluation bundle keys from server not client,
  similarity semaphore `sourceReads=16`); assessment (question bank resolved
  before write transaction to avoid holding DB lock, `withTenantTx` cross-checks
  capability.TenantID, score validated as `big.Rat`, canonical JSON for policy
  checksum, `RepinExamItem` MCQ guard, temporal window guards with 1-minute grace,
  `canonicalJSONObject` before hashing); judge dispatcher (compile-fail
  short-circuit, batch submission with graceful degradation, poll exhaustion
  yields `internal_error` not `time_limit_exceeded`, `sleepContext` for
  cancellation-safe polling, completion validated on Pull). `make build lint test`
  0 issues, all tests pass.
- Complete shared-library and service wiring audit (2026-11-08): all 21
  packages under `backend/libs/pkg/` read and verified (authn Ed25519 JWS
  with canonical base64url enforcement, authz HMAC capability chain,
  authzprojection resync protocol with constant-time manifest comparison,
  rbac Discord-style bitset resolver, httpauth stateless authorizer with no
  positive cache, grpcmtls TLS 1.3 + VerifiedChains enforcement, telemetry
  OTel+Prometheus with path sanitisation for cardinality control, config
  fail-closed mTLS enforcement in staging/production, kms AES-256-GCM with
  random nonce, testutil Testcontainers integration helpers). All 11 service
  HTTP adapter layers verified for consistent parse→authorize→service→write
  ordering, server-generated UUIDs, `Cache-Control: no-store` on sensitive
  responses, and idempotency keying on state-changing endpoints. Gateway edge
  handler verified: header injection prevention (X-AetherCode-* always
  blocked, X-Forwarded-* stripped and rewritten), path traversal rejection
  (.., //, RawPath), SEB enforcement, no-proxy/no-redirect HTTP client,
  and `no-store` wrapper on the entire Identity handler. Authorization client
  chain verified: blocking dial (service starts only if User service is
  reachable), decision-capability cross-check (CapabilityID==DecisionID,
  ActorID, TenantID, AuthzRevision all validated), and MFA structured gRPC
  detail detection. `make build test` 0 issues.
- Remaining service adapter and judge sandbox audit (2026-11-08): SEB adapter
  verified (`Cache-Control: no-store` on session issuance and validation,
  `lowerSHA256` fingerprint validation, idempotency on all state transitions
  except append-only validation events, soft vs hard delete with required reason);
  Analytics adapter verified (authorization on every route, configurable per-endpoint
  limit ceiling); Notification adapter verified (self-authorization on preference and
  notification reads, `AuthorizeHTTP` for staff scheduling, community routes
  disambiguate staff (`community_moderation`) vs member (`community`) resource at
  authorization time, body size bounded to 256 KiB, path values win over body keys
  to prevent IDOR via body); Assessment adapter verified (appService and
  httpAuthorizer interfaces for testability, `WriteCommand.IdempotencyKey` threaded
  through all write commands, `RepinExamItem` requires separate `exam_items` write
  authorization, `MoveAssignmentWindow` does not require idempotency key since it is
  idempotent by nature); Judge gRPC server verified (`clientSubject` falls back to
  "submission" in dev — callers are partitioned by mTLS CN in production, rate
  limiting checks non-empty `TenantFairnessKey` before engine admission,
  unrecognised verdict codes → `codes.Internal` not a pass); Judge engine client
  verified (`ExpectedOutput: ""` — expected outputs are never sent to the execution
  engine, grading happens in `OutputsMatch` on the platform side, `Proxy: nil` and
  `CheckRedirect → ErrUseLastResponse` on engine HTTP client, `maxPendingVerdicts`
  bounds in-memory verdict map, `newToken` uses `crypto/rand`); `OverallVerdict`
  treats unrecognised verdicts as `internal_error` (fail-closed); poll exhaustion
  returns `internal_error` not `accepted`. `make lint` 0 issues (all 12 modules).
- Service entrypoint and frontend audit (2026-11-08): all 11 service `cmd/server/main.go`
  wiring verified — every service has `signal.NotifyContext` SIGTERM handling, OTel
  shutdown with 5s timeout, `dbmetrics.Register` pool metrics, telemetry middleware,
  readiness chain that gates on every dependency before `/readyz` returns 200, and
  `defer pool.Close()` on each pgxpool; Gateway main verified (NATS optional with
  graceful degradation, realtime hub+prober started before HTTP); Identity main
  verified (three-consumer authzprojection resync stack, separate mTLS introspection
  listener with defense-in-depth TLS 1.3 assertion); Judge main verified
  (JUDGE_ENGINE_COMPATIBILITY_APPROVED gate, mTLS TLS 1.3 assertion, gRPC health
  protocol with NOT_SERVING drain, graceful stop with timeout fallback); Submission
  main verified (fail-fast guards: dispatch requires completion, completion requires
  NATS, ProcessOnce startup drain for judge completion and expiry workers); httpx
  server verified (production timeouts: ReadHeaderTimeout=5s, ReadTimeout=15s,
  WriteTimeout=15s, IdleTimeout=60s; readiness error logged server-side only, never in
  response body); golangci.yml verified (bodyclose, errcheck, errorlint, rowserrcheck,
  sqlclosecheck, staticcheck, unused, govet/shadow); identity postgres `truncate`
  function fixed to walk back to a UTF-8 rune boundary before slicing. Frontend: ESLint
  zero issues (removed stale eslint-disable directives in `mfa-gate.tsx`, fixed ternary
  side-effect expression in `role-editor.tsx`, removed unused imports from e2e specs);
  `make web-check web-build` passes clean (111 tests, 0 errors).

- HTTP adapter full audit (2026-11-08, second run): all 9 service HTTP adapters reviewed
  (analytics, assessment, gateway, identity, notification, question-bank, seb, submission,
  tenant) — consistent parse→authorize→service pattern, server-generated UUIDs,
  `pagination.ParseLimit` on every list endpoint, no authorization bypasses or IDOR vectors.
  nginx-site.conf: added missing `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`
  headers. next.config.ts: added `X-Frame-Options: DENY`. Notification community `?limit`
  parameter now rejects values outside [1, 100] (was unbounded, forwarded to PL/pgSQL LIMIT
  directly). ingress-nginx AppArmor fix codified: `deploy/helm/values-ingress-nginx-kernel-workaround.yaml`
  replaces the hand-applied kubectl patch; ADR-0076 written. Zero TODO/FIXME markers in Go
  source files. `make lint test web-check` clean.
- Analytics department batch progress rollup (2026-11-08, fourth run): migration 000019
  (`batch_progress_department_rollups`) written; new table adds `department_id` to the batch
  progress PK, resolving the analytics gap where department-scoped staff could not read only
  their slice without a client-side workaround. ADR-0077. Go service layer, repo adapter, and
  HTTP endpoint `GET /v1/tenants/{tid}/batch-progress/{bid}/by-department` wired.
  Projection worker `rebuildBatchProgress` now also rebuilds the department slice.
  Migration must be applied before deploying. `make lint test` clean.
- Docker Compose healthchecks (2026-11-08, ninth run): all 11 platform services, gateway, and
  frontend now have healthcheck entries in `docker-compose.yml`. A shared `x-healthcheck` YAML
  anchor uses `wget --spider -q http://localhost:8080/healthz`; the frontend uses `/system-check/ping`
  on port 3000. Previously only infra services (postgres, nats, minio) had healthchecks.
- Analytics smoke test coverage (2026-11-08, ninth run): `smoke.py` now covers all 6 analytics
  API paths: student-progress (with 30-second event propagation polling), exam-results (with 403
  for students), batch-progress, placement-progress, and report-exports (idempotency + storage-key
  redaction). Smoke test now covers every service end-to-end (75 checks total).
- Outbox/inbox retention cleanup and security headers (2026-11-08, tenth run): `OutboxStore.CleanPublished`
  and `InboxStore.CleanProcessed` added to `libs/pkg/messaging/`; `Publisher.Run` and `PullConsumer.Run`
  call each every 5 minutes, deleting rows older than 8 days. All 9 services' `app.outbox_events`
  and the analytics/submission `app.inbox_messages` tables previously grew unbounded.
  `PullConsumer` gains a `WithInboxCleaner` builder method; the `InboxCleaner` interface keeps the
  consumer decoupled from the store. Also added `MaxBytes: 2 GiB` to the NATS platform stream in
  `ensurePlatformStream` — previously only `MaxAge: 8 days` with no size cap.
  `Permissions-Policy` header added to `deploy/single-server/nginx-site.conf` and expanded in
  `frontend/next.config.ts` (full 8-directive policy: accelerometer, camera, geolocation, gyroscope,
  magnetometer, microphone, payment, USB — all denied; nginx previously had no policy at all;
  frontend had only camera/microphone/geolocation).

- Security and infrastructure fixes (2026-11-08, eleventh run): `Cache-Control: no-store`
  centralised in `httpx.WriteJSON` — analytics, assessment, tenant and most notification routes
  previously had no cache-prevention header (risk: proxy caching authenticated responses for the
  wrong tenant); assessment's direct `getExamVersionContent` write path patched separately. NATS
  stream config now calls `UpdateStream` when stream already exists so `MaxBytes: 2 GiB` applies
  to existing deployments, not only fresh ones. PostgreSQL image aligned to 18.6 across
  `docker-compose.yml` and `platform-migrations/values.yaml` (was 18.4; `platform-infra` already
  used 18.6). `make lint test web-check` clean.

- OpenAPI spec completeness (2026-11-08, twelfth run): 67 handler operations were registered but
  missing from their service's `api/openapi.yaml`, meaning `endpoint_sweep.py` never exercised
  them. All 9 service specs are now fully aligned with their HTTP handlers — symmetric diff is 0
  across analytics, assessment, identity, notification, question-bank, seb, submission, tenant, and
  user. Notable additions: assessment (12 ops: GET/PATCH/DELETE exam, proctor-policy
  get/list/list-versions, section/item delete, repin, move-window), identity (6 ops: SSO, MFA
  step-up, change-password, get/delete principal), user (15 ops: roles, role-overwrites, account
  bulk ops, staff-audit, student roster/delete), tenant (10 ops: placement-org CRUD, entity hard
  deletes), submission (6 ops: attempt delete/hard, judge-receipts, unit-results, regrade,
  grading-queue), question-bank (9 ops: model-checks, templates, asset download, soft/hard deletes),
  seb (3 ops: config payload, deletes), notification (4 ops: preference PUT, notification deletes),
  analytics (2 ops: report-export deletes). `make lint test` clean.

- Dead code and dependency hygiene (2026-11-08, thirteenth run): removed `StudentGormRepo` from
  `services/user` — implemented as an ADR-0013 demonstration but never wired; was the sole reason
  `gorm.io/gorm` appeared as a direct dependency of the user module. Removed dead GORM test from
  `postgres_test.go`, `gorm:"index"` tag from `domain/student.go`, and a misleading comment in
  identity. Applied `rangeint` modernisation in identity's MFA recovery-code loop. Broad production
  readiness audit completed: rate limiter coverage verified (gateway/identity/submission), judge
  fairness key (per-tenant admission limiting), `WithTenantTx` / `authz.set_context` coverage
  (all user-facing mutations gated; raw `BeginTx` only in projection workers and identity auth),
  model-check security chain (encrypt-before-store, hidden tests never leave MinIO), Helm resource
  limits / PDB / HPA template confirmed, credential isolation per service confirmed, backup atomic
  write pattern, `math/rand` absent from all production paths. `make lint test` clean.
- Full production readiness deep audit (2026-11-08, fourteenth run, no code changes): verified
  capability validation chain (`ValidateAt`: UUID format, TTL 0<t<=5s, HMAC length, clock skew),
  practice run hidden-test isolation, readiness check completeness in all 11 services (full
  dependency chain including NATS consumers, projection stores, judge workers), isolation check
  auto-covers 170 tenant-scoped operations (510 cross-college calls), NATS consumer permanent vs
  transient error handling, gateway header injection defence and WebSocket origin validation,
  security headers at both nginx and Next.js layers, zero string-concatenated SQL, 1 MiB request
  body bound, HTTP server timeouts, graceful SIGTERM shutdown, proto generation zero-drift,
  dependency version consistency (Go 1.26.0, pgx 5.11.0, nats 1.55.0, grpc 1.85.0),
  `govulncheck` 0 reachable vulnerabilities, all `nolint` suppressions justified and documented.
- Live monitor real-time WebSocket (2026-11-08, fifteenth run): `MonitorBoard` replaced its
  15-second `setInterval(router.refresh())` polling with `LiveRefresh` over the existing gateway
  WebSocket. The monitor now re-renders from the server within ~750 ms of any `attempts` or
  `grading` event (student starts, submits, gets graded) instead of waiting up to 15 seconds.
  Falls back to 15-second polling when the WebSocket is down. No backend changes needed — the
  gateway hub already published these events.
- Image alignment, admin hardening, test coverage (2026-11-08, sixteenth run): aligned 3 remaining
  Postgres images to 18.6 (root dev compose, judge-control compose, tools Dockerfile — missed in the
  eleventh run). Admin analytics and incidents pages now catch fetch failures inline with `LoadError`
  instead of falling to the root error boundary. Incidents description updated to "real time." Admin
  loading state added. Frontend test count raised to 144 (utils, lettermark, formatCountdown).
  SEB entry page metadata added. `make lint test web-check web-build` clean.
- Handler separation and results LiveRefresh (2026-11-08, seventeenth run): tenant service
  placement handlers extracted into `placement_handler.go` (were interleaved with tenant CRUD);
  user service role assignment handlers consolidated into `roles_handler.go` (alongside existing
  role CRUD/overwrites). Results page (`/staff/exams/{id}/results`) now gets `LiveRefresh` on
  the `grading` topic so results appear in real time as attempts are graded. Frontend README
  screens table updated from M5-only to all current routes. `make lint test web-check` clean.

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
4. [Done in PR #33] v1's FAQ page published the Safe Exam Browser quit password; removed from `apps/exam-v1/HOPE-Assessment-FAQ.html` and `apps/exam-v1/app/faq/page.tsx` (replaced with instructions to contact proctors). Password on running servers should still be reset.
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
   - the judge control plane (its own Postgres + RabbitMQ) and the execution engine.

   A script generates a local CA and the mTLS certificates for each service.
   A one-shot provisioner creates roles and runs every migration with its
   migrator. Bootstrap uses `make bootstrap`.
2. Fix the known breakers that block a single exam:
   - `extensions.uuid_generate_v7()` is called but never defined (assessment
     000010/000011);
   - judge-control Helm/env names don't match the Go config
     (`AETHERCODE_ENGINE_URL`, `JUDGE_ENGINE`);
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
   score, with the real engine locally (`make dev-judge-up`).

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
- **D4, engine gate:** approved for the campus server with `engine-check`
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
- **Execution engine security gate:** prove the engine listens on a private
  address only, runs submissions with no network, no privilege escalation and
  read-only roots, and records the result before an engine dispatcher or
  submission-admission adapter is enabled.
- **Production performance and continuity evidence:** execute the 10,000
  candidates/five-minute load profile against the approved engine and real
  question suite; demonstrate submission P95 ≤2 seconds and final-verdict P95
  ≤60 seconds. Exercise PostgreSQL, RabbitMQ, Judge worker, and wrapper-node
  loss with durable queue replay and no lost work.
- **Secrets and security approval:** provision and rotate real authorization
  HMAC material, mTLS issuers, database client certificates, image-signing
  keys, monitoring/alerting destinations, and complete the ASVS, SEB, and Judge
  sandbox security reviews.
