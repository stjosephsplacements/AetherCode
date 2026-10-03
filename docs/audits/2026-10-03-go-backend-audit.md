# Go Backend Audit (2026-10-03)

Scope: the 11 services in `services/`, the shared libraries in `libs/`, the
contracts in `libs/proto`, and `deploy/`. The question asked was: what is
missing before a college can run a graded, SEB-locked coding exam on the
platform alone (ADR-0017)?

Method:
- build and unit tests;
- a placeholder scan;
- mapping every event to its producer and consumer;
- reading the code along the exam path: account → authoring → exam →
  attempt → grading → results;
- checking each known-bug report in `Prompt.md` against the current code.

## What is solid

- **Build and tests:** `make build` and `make test` pass (63 packages). There
  are no `TODO`/stub/"not implemented" markers in production code.
- **Security model:**
  - per-request signed capabilities, `FORCE ROW LEVEL SECURITY`, and
    security-definer write paths;
  - fail-closed authorization projections with resync;
  - idempotency keys and transactional outboxes.

  This is consistent across services.
- **Implemented workflows:**
  - identity: registration, login, MFA, refresh rotation, reset;
  - tenants, departments, batches, roles and student affiliations;
  - immutable question and exam versions with publish;
  - assignment rules and candidate-assignment snapshots;
  - attempts, append-only answers and submit;
  - attempt expiry;
  - judge-completion ingestion with per-test-case results and a
    candidate/reviewer visibility split;
  - analytics read models (student, batch, placement progress; exam results;
    exports);
  - in-app notifications and SEB configuration/session records.
- **Judge side:** a real Judge0 HTTP client behind the compatibility gate,
  bundle fan-out into one execution unit per test case (ADR-0014), and
  per-unit completions.

## A. Blockers: an exam cannot run until these are fixed

| # | Gap | Evidence |
|---|---|---|
| A1 | **Nothing dispatches submissions to the judge.** `submission.evaluation_requested.v1` is consumed only by analytics; no service calls judge `SubmitExecution`. | Event map: the only consumer of `evaluation_requested` is `services/analytics`. `services/submission/README.md` §Event contracts. |
| A2 | **The judge sends encrypted references to Judge0 as source code and stdin.** No decrypt-and-fetch step exists before dispatch. | `services/judge/internal/adapters/repo/store_adapter.go:66-68` |
| A3 | **No raw upload path.** Question manifests, evaluation bundles and answer revisions take pre-encrypted object keys from the caller. No service builds a bundle or encrypts source or tests. Storage/KMS are wired into submission but unused. | `question-bank` `manifestRequest.ObjectReference`; `submission` README ("unused until … run-code"). |
| A4 | **Assigning an exam to a batch, department or enrolment crashes.** The materialisation functions call `extensions.uuid_generate_v7()`, which is not defined anywhere. Postgres 18 has the built-in `uuidv7()`. | `services/assessment/migrations/000010_assignment_materialization.up.sql:73,74,208,209`; `000011_batch_department_populator.up.sql:138` |
| A5 | **SEB validation can never match a real Safe Exam Browser.** SEB sends `X-SafeExamBrowser-ConfigKeyHash` = SHA-256(absolute request URL + Config Key), which differs per URL. The platform compares SHA-256(header) to one stored hash. | `services/gateway/internal/edge/handler.go:383-397`; `services/seb/migrations/000006_self_session_validation.up.sql` (`expected_hash = p_presented_header_hash`) |
| A6 | **SEB has no configuration supply chain.** Nothing generates, encrypts or uploads a `.seb` file or derives its Config Key. The gateway also needs custom `X-AetherCode-SEB-Tenant-ID/Session-ID` headers, which only frontend code can add. Behind a Next.js backend-for-frontend, the SEB headers reach the Next server, not the gateway. | `services/seb/README.md` (configurations are opaque object references); gateway SEB section. |
| A7 | **No way to create student accounts at scale.** The only path is self-registration with email verification, and there is no email channel ("Email is deliberately not exposed"). There are no admin-created accounts, no bulk import, and no sign-in by roll number: login needs `email` + `tenant_id`. Enrolment needs an existing `principal_id`. | `services/identity/internal/adapters/http/handler.go:105-170`; `services/notification/README.md:24`; `services/user/.../handler.go:84-89` |
| A8 | **Unsubmitted work is never graded.** At time-up the expiry worker marks attempts `expired` but creates no evaluation requests for the latest answers. | `services/submission/migrations/000017_attempt_expiry_worker.up.sql` (`expire_overdue_attempts`) |
| A9 | **No frontend.** `web/` is empty. | — |
| A10 | **No single-server deployment.** Services deploy only via the Helm `platform-service` chart. The kustomize overlays are empty, and the root compose file starts only infrastructure. The campus server needs all 11 services, mTLS certificates, role provisioning and migrations on one machine. | `deploy/kustomize/overlays/*` empty; `docker-compose.yml` services. |
| A11 | **The judge chart can't start a working engine.** The judge-control values use `JUDGE_ENGINE_ENDPOINT`, `JUDGE_ENGINE_AUTH_TOKEN` and `JUDGE_ENGINE_MODE`. The Go config reads `JUDGE0_BASE_URL`, `JUDGE0_AUTH_TOKEN` and `JUDGE_ENGINE`. | `deploy/helm/charts/judge-control/values.yaml` vs `services/judge/internal/config` |

## B. Bugs (wrong behaviour today)

| # | Bug | Evidence |
|---|---|---|
| B1 | **Analytics rejects every `judge.completed.v1`.** The decoder struct has no `completed_at` and uses `DisallowUnknownFields`, so `exam-results` never fills. | `services/analytics/internal/adapters/projection/projection.go` (`judgeCompleted`, `decodeEvent:776`) |
| B2 | **Hard-deleting an attempt is always denied.** The route authorizes action `delete`; the central authorizer accepts only `read`/`write`. | `services/submission/internal/adapters/http/handler.go:327`; `services/user/internal/app/authorization.go:301` |
| B3 | **Hard-deleting a student can't succeed for an enrolled student** (FK/trigger chain). | ADR-0013 Known limitations |
| B4 | **The reviewer per-test view is tenant-wide**, not limited to the reviewer's batch or department. | ADR-0015 Consequences |
| B5 | **Run-code is half built:** `submission.code_runs` has no UPDATE path, so a run can never leave `queued`. Plan D Tasks 4–7 are not started. | `Prompt.md`; plan `2026-08-24-candidate-run-code.md` |
| B6 | A dead migration test (`000016_attempt_list_functions_test.sql`) never runs. | `scripts/verify-migrations` glob |

## C. Exam features missing compared with the reference app (`apps/exam-v1`)

| Area | Missing on the platform |
|---|---|
| Authoring | Staff authoring rights (D1: any staff role, one master bank; today only Golden users); test upload and zip import; model-solution check; multiple choice; question export/import; duplicate exam |
| Exam setup | Question pools (one random question per slot); network allow-list; fullscreen and paste flags; preview as student |
| During the exam | Run against samples with per-test output (B5); auto-submit of the latest answer (A8); flags log (window switches, fullscreen exits, pastes); announcements (in-app notifications exist, but no exam-scoped broadcast); extend time for one student or everyone; end exam |
| Results | Live monitor; per-slot results table and CSV for faculty (analytics `exam-results` exists but is fed by B1); result release to students; similarity report; regrade |
| Admin | CSV import with generated passwords and login slips; batch password reissue; audit log of staff actions (no audit read model exists); system status page; automatic backups |

## D. Coverage and operations

- **Integration tests:** `analytics`, `gateway`, `notification` and `seb` have
  none. B1 and A5 would have been caught by them.
- **Unconsumed events:** about 40 events have no consumer. Most are fine as
  future analytics inputs. The ones that matter are
  `submission.evaluation_requested.v1` (A1) and
  `identity.principal.registered.v1`: no profile or enrolment follows a new
  principal, so accounts and student records have to be stitched together
  manually.
- **External gates** in `PENDING.md` still apply: India-resident KMS and object
  storage, a notification provider, the HA drills and the load evidence.

## Priority order

1. **To run one exam at all:**
   - A4, A11, B1 (small fixes);
   - A10 (single-server stack);
   - A7 (accounts);
   - A3 + A1 + A2 + A8 (grading loop);
   - A5 + A6 (SEB, now required);
   - A9 (frontend).
2. **For parity:** section C, then B2–B6 and the integration-test gaps in D.

These map onto the phases in
`docs/superpowers/plans/2026-10-02-go-platform-exam-parity.md`. SEB (A5/A6)
moves into Phase 1 because D3 makes it required.
