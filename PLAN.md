# AetherCode — Architecture & Implementation Plan

> Multi-tenant, microservices coding-exam platform for colleges, with Safe Exam
> Browser (SEB) enforced testing, a medallion role hierarchy, and a dedicated
> Judge0 execution wrapper. Self-hosted on bare metal + Kubernetes.

**Status:** Draft v1 · **Owner:** Platform Team · **Last updated:** 2026-07-24

---

## 1. Vision & Scope

AetherCode is a coding-assessment platform that lets colleges run proctored
coding exams and (later) LeetCode-style practice. It is built microservices-first
so new capabilities (practice, contests, interview prep) can be added without
reworking the core.

### 1.1 In scope (v1)
- Multi-tenant onboarding of colleges and their departments.
- Medallion RBAC (Golden / Silver / Bronze) across tenants.
- Global question bank (only global users author questions; everyone consumes).
- Exam authoring, scheduling, and assignment — including cross-college
  placement exams.
- SEB-enforced exam sessions (normal browsing on the web app, exams only in SEB).
- Code execution via an isolated Judge0 wrapper microservice.
- Mentor/student progress tracking.

### 1.2 Out of scope (v1, planned later)
- LeetCode-style public practice & contests (architecture must not preclude it).
- AI proctoring / webcam analysis.
- Plagiarism detection.
- Payments/billing.

### 1.3 Non-negotiable principles
- **Modular at the code level** — clean/hexagonal boundaries, no leaking layers.
- **No placeholders / no dead code** — every line ships a purpose.
- **Professional & documented** — each module carries a `README.md`.
- **Latest stable stack** — versions verified via Context7 before locking.
- **Best practices by default** — security, testing, observability, IaC.
- **Simplicity** — the least code that satisfies the requirement.

---

## 2. Tech Stack

> Initial version pins were verified against upstream primary documentation on
> 2026-07-24 because Context7 is unavailable in this workspace. The evidence
> and immutable image digest are maintained in
> [`docs/architecture/version-verification.md`](docs/architecture/version-verification.md).

| Layer | Choice | Target version | Notes |
|---|---|---|---|
| Backend services | Go | `1.26.5` | Go workspaces (`go.work`) monorepo |
| Sync inter-service | gRPC + Protobuf | `1.82.1` / `1.36.11` | Contracts in `libs/proto` |
| Platform event bus | NATS JetStream | `2.14.3` | Domain events, at-least-once |
| Judge queue/broker | RabbitMQ | `4.3.3` | **Isolated** to the Judge wrapper |
| Primary DB | PostgreSQL | `18.4` | Three-node HA cluster; database per platform service |
| Judge control DB | PostgreSQL | `18.4` | Separate HA deployment for the wrapper |
| Judge0 engine DB | PostgreSQL | upstream-compatible `16.x` | Opaque upstream schema, never touched by wrapper migrations |
| Cache/session | Redis | `8.8.0` | Isolated Judge Redis remains an engine concern |
| Object storage | S3-compatible, India-resident | — | Encrypted question assets, SEB configs, reports, and backups |
| Orchestration | Kubernetes + CloudNativePG | `1.30.x` | Self-hosted bare metal; quorum synchronous replication |
| Packaging | Helm + Kustomize | — | `deploy/` |
| Ingress | Ingress-NGINX or Traefik | latest | TLS via cert-manager |
| Observability | OpenTelemetry, Prometheus, Grafana, Loki, Tempo | latest | Full traces/metrics/logs |
| Migrations | golang-migrate | `4.19.1` | Per-service `migrations/`; PostgreSQL advisory locking |
| AuthN | JWT (access) + refresh, Argon2id hashing | — | Issued by Identity service |

---

## 3. Deployment Target (Bare Metal, HA From Day One)

Production uses three independently powered, India-hosted data nodes from the
first release. A single-node deployment is not an accepted production topology.

- **Platform PostgreSQL:** one CloudNativePG cluster with three instances,
  required hostname anti-affinity, one synchronous replica per committed write,
  automated primary promotion, encrypted WAL archive, and India-resident
  off-site backup/PITR storage.
- **Logical isolation:** each platform bounded context receives its own logical
  database in that cluster. There are no cross-database foreign keys or direct
  service reads across ownership boundaries.
- **Judge isolation:** the wrapper control plane has a separate PostgreSQL HA
  deployment and a three-node RabbitMQ quorum cluster. Judge0's engine database
  is a third, version-pinned deployment with its upstream schema left opaque.
- **Compute:** reserve dedicated `role=judge` nodes for execution workers and
  separate `role=postgres` nodes for data. A Judge runtime must pass the
  gVisor/no-network/non-privileged gate before receiving production traffic.
- **Residency:** primary data, object storage, WAL archives, backups, and
  PII-bearing telemetry stay in India. A node, replica, or backup target outside
  India blocks promotion.

The current CloudNativePG chart is render-gated on certificate and
India-resident backup inputs; its node-loss and restore acceptance exercises
are in [`deploy/runbooks/platform-postgres-ha.md`](deploy/runbooks/platform-postgres-ha.md).

---

## 4. Medallion RBAC Model

Roles map to three tiers. Authorization is enforced centrally (policy engine)
and re-checked in each service.

### Golden (global, cross-tenant)
- **Super Admin** — full platform control; manages tenants, global config.
- **Placement User** — manages multiple colleges' students; assigns one exam
  across students from many colleges (the placement department).

> **Only Golden users can author questions.** The question bank is global; every
> tier can *consume* questions in exams they are allowed to create.

### Silver (tenant-scoped: one college)
- **College Admin** — full control of their college tenant.
- **Department User** — manages their department's students; runs department
  exams.

### Bronze (scoped to a batch or self)
- **Mentor** — assigned a batch by a department admin; tracks progress and runs
  internal batch tests.
- **Student** — takes assigned exams.

### Permission model
- Roles are **assignments**, not columns: `(user, role, scope)` where scope is
  `platform | college:<id> | department:<id> | batch:<id>`.
- A user may hold multiple assignments (e.g., a placement staffer is Golden;
  a lecturer may be Department User in two departments).
- Central policy: attribute/relationship-based (Casbin or OpenFGA-style tuples).
  **Decision:** start with Casbin (RBAC + domains) — simplest that fits; revisit
  OpenFGA if relationship depth grows. Recorded as ADR-0004.

---

## 5. The Two-Department Exception

Every student belongs to **two** departments simultaneously:

1. **College Department** — owned by department staff; single college.
2. **Placement Department** — owned by placement staff; **may contain students
   from many colleges**.

Data model consequence: `student ↔ department` is many-to-many with a
`department_type ∈ {college, placement}` discriminator. A placement department is
*not* nested under one college tenant — it is a **cross-tenant grouping** owned at
the Golden tier. Row-Level Security policies must allow placement staff to read
students across colleges *only* through the placement-department relationship.

```
Tenant(College) 1---* Department(college)  *---* Student  *---* Department(placement) *---1 PlacementOrg(Golden)
```

---

## 6. Microservices

Each stateful platform service owns a separate logical database in the platform
HA cluster. Sync calls use gRPC; state changes propagate through versioned
domain events on NATS JetStream. Cross-database foreign keys are prohibited:
services retain opaque IDs and validate ownership through contracts or local,
event-fed projections.

| # | Service | Responsibility | Data |
|---|---|---|---|
| 1 | **gateway** | Edge: routing, TLS, JWT validation, rate limiting, SEB header checks | stateless |
| 2 | **identity** | AuthN, credentials, MFA, refresh families, reset/lockout and auth events | `aether_identity` |
| 3 | **tenant** | Colleges, departments, placement orgs, retention policies and legal holds | `aether_tenant` |
| 4 | **user** | Profiles, canonical Casbin authorization, role/membership history and affiliations | `aether_users` |
| 5 | **question-bank** | Immutable question versions, tags, test manifests, encrypted asset references | `aether_qbank` |
| 6 | **assessment** | Immutable exam versions, snapshots, assignments and proctor policy | `aether_assessment` |
| 7 | **submission** | Attempts, append-only answer revisions, evaluation requests and scores | `aether_submission` |
| 8 | **judge** (Judge0 wrapper) | Isolated execution gateway, reconciliation and terminal delivery leases | **separate** `aether_judge_wrapper` HA DB + RabbitMQ quorum + private engine |
| 9 | **seb** | Encrypted SEB configuration objects, sessions, validation/audit events | `aether_seb` |
| 10 | **notification** | Notifications, preferences, provider idempotency and delivery attempts | `aether_notification` |
| 11 | **analytics** | Event-fed progress, exam, batch, placement and export read models | `aether_analytics` |

Shared cross-cutting concerns live in `libs/` (config, logging, auth middleware,
db, messaging, telemetry, errors) — **never** copy-pasted per service.

### 6.1 Judge0 Wrapper (hard isolation requirement)
- Runs in its own namespace/node pool (`role=judge`), own PostgreSQL and own
  RabbitMQ — **no shared broker with the platform bus.** Judge0's Redis/Resque
  queue is an internal engine detail, not a wrapper dependency.
- Flow: `submission` calls `SubmitExecution` over mTLS → wrapper persists an
  idempotent job → admission/retry workers use RabbitMQ quorum queues → workers
  submit/poll private Judge0 → wrapper writes a terminal encrypted result
  reference → the submission adapter pulls a leased completion over mTLS,
  persists it idempotently, acknowledges it, then publishes `judge.completed.v1`
  to NATS. Judge never shares the platform broker.
- Sandboxing must prove gVisor compatibility with no network, no privilege,
  read-only rootfs, dropped capabilities, and CPU/memory/pids/wall-time limits.
  The upstream privileged sample compose configuration is forbidden.
- Wrapper exposes a stable internal API so the underlying engine (Judge0 today)
  can be swapped later without touching `submission`.

---

## 7. Safe Exam Browser (SEB) Flow

Goal: the site works in any browser, but an **exam session only runs inside SEB**.

1. Student authenticates in a normal browser and opens an assigned exam's
   "Launch" page.
2. `seb` service generates a signed `.seb` configuration (exam URL, quit URL,
   allowed processes, browser lockdown) and computes the **Config Key**.
3. The browser downloads the `.seb` file → the OS hands it to the installed SEB
   client, which relaunches into locked-down mode and requests the exam URL.
4. SEB attaches `X-SafeExamBrowser-ConfigKeyHash` (and, if provisioned, a
   Browser Exam Key `X-SafeExamBrowser-RequestHash`) to every request.
5. `gateway` + `seb` verify the header hash against the expected value for that
   exam+URL. **No valid SEB header → 403 → redirect to an "Open in SEB" page.**
6. On submit/quit, SEB navigates to the signed quit URL; the session is closed
   and further SEB requests for that attempt are rejected.

Server-side enforcement (not just client config) is mandatory — the hash check
is the real gate. Config Keys are per-exam and rotated; keys never ship to the
client in plaintext.

---

## 8. Multi-Tenancy & Data Isolation

- **Tenant columns and RLS:** every tenant-owned table carries `tenant_id` and
  uses `FORCE ROW LEVEL SECURITY`. Identity, global question-bank records, and
  wrapper operational records are exempt only when no tenant ownership applies.
- **Central decision, local enforcement:** User is the canonical Casbin-backed
  authorization service. Every protected request validates identity, obtains a
  fresh mTLS `Authorize` decision, and fails closed on any error. The decision
  carries a monotonically increasing `authz_revision`, resource scope, and a
  five-second, audience-bound capability.
- **Non-forgeable transaction context:** target databases verify the capability
  in a security-definer function, bind it to `pg_backend_pid()` and
  `txid_current()` in an ephemeral context row, then set transaction-local
  coordinates. RLS verifies both the bound context and an exact revision match
  in its local event-fed authorization projection. Application roles cannot
  write projection data or manufacture GUCs to bypass RLS.
- **Immediate revocation:** role and placement changes increment the canonical
  revision and synchronously invalidate authorization/session state. Projection
  lag denies access rather than extending a stale grant; no positive decision
  cache crosses a request boundary.
- **Two-department rule:** current affiliations enforce exactly one active
  college department and one active placement department for an active student.
  Department type and ownership come from the tenant projection; history is
  retained rather than overwritten.
- **Versioning and payloads:** application-generated UUIDv7 identifiers and UTC
  timestamps are used throughout. Published question/exam versions and answer
  revisions are immutable. Source, hidden tests, SEB configuration, and large
  results are encrypted object-storage references with checksums, never plaintext
  secrets in PostgreSQL.

### 8.1 Logical database ownership

| Database | Owned records |
|---|---|
| `aether_identity` | Principals, password credentials, MFA, refresh families, reset/lockout, auth events |
| `aether_tenant` | Tenants, placement organizations, departments, batches, retention policies, legal holds |
| `aether_users` | Profiles, student records, role assignments, mentor links, department history and current affiliations |
| `aether_qbank` | Questions, immutable versions, tags, test manifests, encrypted asset/evaluation references |
| `aether_assessment` | Exams, immutable versions, sections, question snapshots, assignments, candidate projections, proctor policies |
| `aether_submission` | Attempts, answer revisions, evaluation requests, Judge receipts, scores and attempt events |
| `aether_seb` | Encrypted configuration references, key hashes, sessions, validation and audit events |
| `aether_notification` | Notifications, preferences, provider idempotency and delivery attempts |
| `aether_analytics` | Event-fed progress, exam, batch, placement and export read models only |
| `aether_judge_wrapper` | Wrapper jobs, execution units, dispatch attempts, mappings, inbox/outbox and reconciliation state |

Every publisher/consumer database owns inbox, outbox, and idempotency records.
High-volume event, delivery, execution, and analytics histories are monthly
partitioned. Schema evolution follows expand → backfill → contract releases;
paired migration files use the PostgreSQL advisory lock provided by the
golang-migrate driver.

### 8.2 Retention and legal holds

Tenant retention settings and legal holds are authoritative in `aether_tenant`.
Initial defaults are seven years for academic/source/result and audit records,
one year for authentication logs, 90 days for notification deliveries, 30 days
for wrapper execution records, and 24 hours for upstream Judge0 payloads after
durable completion acknowledgement. A legal hold defeats scheduled deletion.

---

## 9. Repository Layout (monorepo, Go workspaces)

```
aethercode/
├── PLAN.md  CLAUDE.md  AGENTS.md  TASKLIST.md  README.md
├── go.work                      # Go multi-module workspace
├── Makefile                     # dev/build/test/lint entrypoints
├── docker-compose.yml           # local platform profile (pg, redis, nats, object storage)
├── .golangci.yml  .editorconfig
├── docs/
│   ├── architecture/            # C4 diagrams, sequence flows
│   ├── adr/                     # Architecture Decision Records
│   └── api/                     # rendered OpenAPI
├── deploy/
│   ├── helm/                    # HA database and per-service charts
│   ├── kustomize/{base,overlays/{dev,staging,prod}}
│   └── bootstrap/               # node prep, k3s/kubeadm, storage classes
├── libs/                        # shared Go modules
│   ├── proto/                   # gRPC/protobuf contracts + generated code
│   └── pkg/{config,logging,database,messaging,authz,httpx,telemetry,errors}
├── services/
│   └── <service>/
│       ├── cmd/server/main.go
│       ├── internal/
│       │   ├── domain/          # entities + business rules (no deps)
│       │   ├── app/             # use cases
│       │   ├── ports/           # interfaces (in/out)
│       │   └── adapters/{http,grpc,repo,messaging}
│       ├── migrations/
│       ├── api/openapi.yaml
│       ├── Dockerfile
│       ├── go.mod
│       └── README.md            # required per module
├── web/                         # Next.js app (App Router, TS)
│   ├── app/  components/  lib/  README.md
└── scripts/
```

**Per-service internal architecture:** hexagonal (ports & adapters).
`domain` has zero framework imports; `adapters` depend inward only.

---

## 10. Cross-Cutting Concerns

- **Config:** 12-factor, env-driven, validated on boot (`libs/pkg/config`).
- **Logging:** structured JSON (`slog`), correlation/trace IDs propagated.
- **Errors:** typed domain errors → mapped to HTTP/gRPC codes at the edge only.
- **Telemetry:** OpenTelemetry traces + Prometheus metrics + Loki logs; every
  service exposes `/healthz`, `/readyz`, `/metrics`.
- **Security:** Argon2id passwords, short-lived JWT + rotating refresh, TLS
  everywhere (mesh optional later), secrets via K8s Secrets/SOPS, OWASP ASVS
  checklist, dependency scanning (govulncheck, npm audit), image signing.
- **API style:** REST (OpenAPI) at the edge for the web app; gRPC internally.
- **Idempotency:** submission and judge callbacks use idempotency keys.

---

## 11. Testing & Quality

- **Unit** (domain/app, table-driven Go tests), **integration** (Testcontainers
  for pg/redis/nats/rabbitmq), **contract** (buf breaking + OpenAPI), **e2e**
  (Playwright against a compose stack), **load** (k6 on submission→judge path).
- Coverage gates on domain/app packages; lint via golangci-lint + eslint.
- CI: build → lint → unit → integration → contract → image → sign → deploy(dev).

---

## 12. Delivery Phases (summary — see TASKLIST.md)

0. **Foundations** — repo, workspace, CI, shared libs, local compose, ADRs.
1. **Identity & Tenancy** — auth, RLS, tenants/departments, role assignments.
2. **Question Bank** — global authoring, test-case storage, Golden-only writes.
3. **Judge Wrapper** — isolated Judge0 wrapper, own DB/broker, hardened sandbox.
4. **Assessment & Submission** — exam authoring, assignment, attempts, scoring.
5. **SEB Enforcement** — config generation + server-side key validation + gateway.
6. **Frontend** — Next.js app across all roles; SEB launch UX.
7. **Analytics** — mentor/progress dashboards, exam reports.
8. **Hardening & Deploy** — bare-metal K8s, observability, security review, load.

Each phase ends with: passing tests, module `README.md`, an ADR if a decision was
made, and a deployable increment.

---

## 13. Key Risks

| Risk | Mitigation |
|---|---|
| SEB client-side checks bypassable | Enforce Config/Browser-Exam-Key hash **server-side** at gateway |
| Judge0 sandbox escape | gVisor runtime, seccomp, no-net, cgroup limits, dedicated node pool |
| Cross-tenant data leak | Signed transaction context + `FORCE RLS` + exact local authz revision; projection lag fails closed |
| Execution load spikes during exams | RabbitMQ quorum persistence, worker admission limits, per-tenant fair queuing, and a 10K/five-minute load gate |
| Node or worker loss | Three-node PostgreSQL HA with one synchronous replica, RabbitMQ quorum queues, retry/reconciliation, and failure exercises |
| Judge0 isolation incompatibility | Block release; never copy its privileged sample or weaken gVisor/no-network controls |
| Backup/restore failure | Encrypted WAL archiving, India-only off-site storage, and required PITR restore drills |

---

## 14. Promotion Gates

The following are intentionally not design choices left to a future build; they
are required evidence before production promotion:

1. A load report demonstrates submission acceptance P95 ≤2 seconds and final
   Judge verdict P95 ≤60 seconds for the P90 real question/test-suite profile at
   10,000 candidates submitting within five minutes.
2. A controlled platform PostgreSQL node failure preserves committed writes and
   grading continuity. RabbitMQ replay and Judge token reconciliation also pass.
3. A PITR restore drill reaches the configured recovery objectives and passes
   RLS/placement-isolation verification.
4. The Judge0 v1.13.1 compatibility gate proves gVisor, no-network, and
   non-privileged execution. A failed gate blocks the engine release.
5. India-only residency is verified for primary storage, backup/WAL archive,
   object storage, and PII telemetry.

Architecture decisions and gate outcomes are recorded under `docs/adr/`.
