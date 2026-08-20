# TASKLIST — AetherCode

This is an evidence-based delivery checklist, not a production approval. A
checked item has repository implementation and focused verification; it does
not claim that a live deployment, external provider integration, or promotion
exercise has passed.

Legend: `[x]` delivered repository foundation · `[~]` delivered in part or
awaiting broader verification · `[ ]` not delivered or a blocking release gate.

---

## Foundation and database design

- [x] Local `main` Git workspace, Go workspace, root build targets, editor/lint
  configuration, service directory layout, Dockerfiles, validated config, and
  health/readiness/telemetry baselines for `gateway`, `identity`, `tenant`,
  `user`, `question-bank`, `assessment`, `submission`, `judge`, `seb`,
  `notification`, and `analytics`.
- [x] Shared Go packages for configuration, logging, database access,
  transaction-safe RLS context, UUIDv7, idempotency, inbox/outbox, retry,
  messaging, telemetry, HTTP operations, errors, and authorization primitives.
- [x] Buf source/generation for the common, `authz/v1`, and `judge/v1` gRPC
  contracts.
- [x] Paired `up`/`down` migration packages and migration/rollback guidance for
  every platform database and the separate Judge control-plane database.
- [x] Development database provisioner creates the nine platform logical
  databases with non-login owners and separate migrator, application,
  authorization-reader, and projection-worker roles; public schema creation and
  `BYPASSRLS` are prohibited.
- [x] `scripts/new-service`, `scripts/new-migration`, and the post-bootstrap
  audience-key provisioner establish the repeatable foundation workflow.
- [x] Database-per-service architecture, immutable version snapshots,
  append-only histories, encrypted object-reference rules, partitioned
  high-volume histories, retention/legal-hold model, inbox/outbox, and
  idempotency schema foundations.
- [x] User canonical authorization foundation: Casbin policy/revision data,
  mTLS `authz/v1.Authorize`, five-second audience-bound HMAC capabilities, and
  local `FORCE RLS` authorization-revision projections that fail closed on lag.
- [x] Durable authorization-projection recovery for every RLS-protected
  platform service: target-bound local outbox requests, manifest-verified User
  snapshots, RLS readiness gates, and restart-on-consumer/publisher failure.
- [x] Stateless public Gateway with a fixed private-upstream allow-list,
  per-request Ed25519 assertion verification, bounded local rate limiting,
  spoofed-header rejection, and fail-closed SEB route enforcement.
- [x] Three-node platform PostgreSQL HA chart/runbook foundation with
  synchronous one-replica commit, automatic failover configuration, encrypted
  WAL/PITR configuration, client-certificate roles, and India-residency render
  gates.
- [x] Isolated Judge wrapper persistence/API foundation: separate control-plane
  database model, private mTLS contract, RabbitMQ pointer-admission boundary,
  completion leases, a receive-only Submission completion bridge with a
  dedicated execute-only database identity, and opaque upstream Judge0
  persistence boundary.
- [x] ADRs and runbooks covering topology, authorization/revocation, Judge
  persistence, residency/retention, HA, and the gVisor release gate.
- [x] Safe local compose profiles for platform dependencies and the Judge
  control plane; neither starts the insecure upstream Judge0 sample deployment.
- [~] Initial dependency and image pin evidence is recorded from upstream
  primary sources because Context7 is unavailable in this workspace. Recheck
  through Context7 when it is available before a version change.
- [x] CI runs workspace build/test, format check, go vet, golangci-lint,
  protobuf lint, migration verification, and govulncheck. Integration, image
  signing, deployment, and promotion verification stages remain to be added.

## Database and authorization verification still required

- [x] `make test-migrations` exercises fresh apply, full paired rollback, and
  reapply for every platform database and the separate Judge control-plane
  database using only dedicated non-superuser migrators. It also checks the
  authorization-resync entry points, completion-bridge contract, retention
  worker/legal-hold boundary, and least-privilege grants.
- [x] Focused service tests cover duplicate events/idempotency, immutable
  snapshots, placement access, assignment revocation, recovery gating, and
  SEB candidate binding. 189 validation and contract tests across all services
  verify input boundaries without external dependencies. Expand these into a
  full cross-service CI matrix with live NATS and mTLS dependencies.
- [ ] Exercise tenant retention/legal holds and authorization-projection lag
  under automated multi-service failure scenarios in CI.
- [ ] Provision and rotate real KMS/secret-controller HMAC keys and verify
  target database audience separation in a non-development environment.
- [~] Maintain the protected-endpoint invariant: identity validation, a fresh
  User `Authorize` mTLS call, and one signed local RLS transaction. No positive
  authorization decision may survive a request boundary; new endpoints need
  the same integration coverage before promotion.

## Backend product workflows

- [x] Identity signup/login, password and refresh-session lifecycle, MFA,
  reset, lockout, and authentication-audit APIs.
- [x] Tenant/user management and event publication for colleges, departments,
  batches, profiles, roles, placement scope, two-department membership, and
  current/historical student-batch affiliation.
- [~] Question-bank authoring, immutable versioning, tags, manifests, and
  encrypted object references. A real object-storage/KMS adapter and bulk
  import/export remain external integrations.
- [x] Assessment authoring, immutable exam publication, assignment engine
  (including event-driven batch/department materialization consumer), and
  candidate-assignment snapshot workflows.
- [~] Submission attempt/answer lifecycle, immutable evaluation requests,
  revocation cancellation, durable Judge-completion consumption, score
  aggregation, and analytics-safe event publication including
  `submission.attempt_submitted.v1` outbox event. The completion-only Judge
  adapter is delivered; the separate admission path remains gated with the
  isolated execution phase.
- [~] SEB configuration generation, gateway/header validation, key rotation,
  and server-side exam-route enforcement. The fail-closed Gateway/SEB
  validation path, self-bound session check, strict mutation idempotency,
  rotation workflows, and automatic session closure on attempt submission or
  assignment revocation are implemented; encrypted configuration-object
  generation/storage integration remains outside this backend foundation.
- [~] Notification preferences, in-app notifications, idempotent delivery
  records, event-fed workflow, and a dedicated bounded retention worker that
  serializes legal-hold transitions. External email/SMS provider delivery is
  not implemented without an approved provider and residency configuration.
- [~] Analytics event consumers, read models, batch-progress reporting, and
  legal-hold-gated report-export metadata. Durable encrypted export storage
  remains an external integration.
- [x] Gateway public-edge routing and protected-request/SEB enforcement.
- [ ] Candidate-facing Next.js application, role-aware dashboards, and end-to-
  end UI coverage.

## Judge engine: blocked until evidence exists

- [x] Judge0 engine deployment assets and a compatibility validation procedure
  are present, but the chart is disabled by default.
- [ ] **Blocked:** prove the pinned Judge0 build under gVisor with no privilege
  escalation, no host paths/namespaces/Docker socket, non-root/read-only
  filesystem, and deny-by-default/no-user-controlled network.
- [ ] **Blocked:** implement and verify the approved-phase dispatcher/worker:
  RabbitMQ pointer consumption, Judge0 submission/polling, token
  reconciliation, durable terminal event creation, and retries/fairness.
- [ ] **Blocked:** demonstrate a single Judge wrapper/worker/broker node loss
  with queued-work replay and no lost accepted work.
- [ ] **Blocked:** demonstrate the 10,000-candidate/five-minute burst with
  submission acceptance P95 at or below 2 seconds and final Judge verdict P95
  at or below 60 seconds for the P90 real question/test-suite profile.

## Production promotion evidence not yet delivered

- [ ] Provision the actual three-node, independently powered, India-hosted
  platform PostgreSQL deployment and the independent Judge control-plane HA and
  RabbitMQ quorum deployments.
- [ ] Prove India-only residency for primary data, object storage, WAL/base
  backups, backup replicas, and PII-bearing telemetry.
- [ ] Complete node-failure exercises, RabbitMQ replay, Judge token
  reconciliation, and grading-continuity evidence.
- [ ] Complete encrypted backup and point-in-time restore drills against the
  configured recovery objectives, including restored RLS/placement-isolation
  checks.
- [ ] Complete security review/ASVS work, SEB and Judge sandbox penetration
  tests, vulnerability scanning, observability dashboards/alerts, and image
  signing.

---

## Continuous requirements

- [x] Every current service root and shared package has a README or documented
  package contract; accepted architectural decisions have ADRs.
- [~] Run `make build`, `make test`, `make lint`, and relevant integration tests
  for each change; retain the result with the change. The full integration and
  lint toolchain is not yet evidenced in every environment.
- [~] Keep contracts regenerated and keep source control free of secrets; audit
  this on every promotion candidate.
- [~] Re-verify dependency versions through Context7 when available, otherwise
  attach upstream-primary evidence before adding or upgrading a dependency.
