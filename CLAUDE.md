# CLAUDE.md

Guidance for Claude Code (and any AI assistant) working in the **AetherCode**
repository. Read this before making changes. Companion docs: `AGENTS.md`
(agent operating rules, kept in sync with this file), `PLAN.md`
(architecture), `TASKLIST.md` (delivery), `PENDING.md` (external gates),
`Prompt.md` (latest session hand-off for the microservices work).

---

## What this project is

A coding-exam platform for colleges, in **two independent codebases**:

| Codebase | Path | Status | Use it for |
|---|---|---|---|
| **Exam app v1** | `apps/exam-v1/` | Built for the first graded exams (Oct 2026): Next.js + Postgres + grading worker + Judge0/Piston on one campus server. | Anything the college runs **now**: exams, grading, results. |
| **Platform** | `services/`, `libs/`, `deploy/` | Multi-tenant Go microservices. Strong security foundation, but the core exam loop is **not** wired end to end (see "Platform status"). | The long-term multi-college platform. |

Why two: on 2026-10-02 an audit found the platform could not grade a
submission or show any UI, and the first exam was two days away. The decision
and its consequences are in `docs/adr/0016-lean-exam-app-for-first-launch.md`.
The two share no code or database. Do not couple them.

## Core principles (non-negotiable, both codebases)

1. **Simplicity first.** Write the least code that satisfies the requirement.
   No speculative abstractions, no unused parameters, no dead branches.
2. **No placeholders.** Never commit `TODO`, stub bodies, fake data, or
   "implement later". If it ships, it works. If it can't ship yet, don't add it.
3. **Modular boundaries.** Platform: hexagonal layers `domain` → `app` →
   `ports` → `adapters`, dependencies point inward, `domain` imports no
   framework. Exam app: see "Exam app conventions".
4. **Document every module.** Each service, shared lib and app has a
   `README.md` describing purpose, API, config, and how to run/test it. Keep it
   current.
5. **Best practices by default.** Security, tests, observability, and IaC are
   part of "done", not follow-ups.
6. **Latest stable versions.** Before adding or bumping a dependency, confirm
   the current stable release with the **Context7 MCP** (`resolve-library-id`
   then `query-docs`); if Context7 is unavailable, use the registry
   (`npm view <pkg> version`, `go list -m -versions`). Never guess versions.
   The exam app's pnpm refuses packages published less than a day ago
   (`minimumReleaseAge`); pin an older release rather than relaxing the policy.
7. **Soft delete by default (platform).** Only SuperAdmin can hard delete
   records. Other roles use soft delete (`deleted_at`). Queries filter
   soft-deleted records unless explicitly requesting archived data. See
   ADR-0013.

## Golden rules for changes

- Match the surrounding code's style, naming, and comment density.
- Change the minimum necessary. Don't reformat unrelated code.
- If a change spans a platform service boundary, update the `proto`/OpenAPI
  contract first, regenerate, then implement both sides.
- Any architectural decision → write an ADR in `docs/adr/` (template there).
- Never weaken security controls for convenience. They are load-bearing:
  platform RLS and SEB/judge sandbox; exam-app server-side role checks, the
  hidden-test boundary, and the nginx-overwritten client IP.
- Do not commit secrets. Use env/K8s Secrets; local dev uses `.env`
  (gitignored) — root `.env` for the platform, `apps/exam-v1/.env` for the app.

---

## Repository map

```
apps/exam-v1/       Exam app v1 (Next.js App Router + worker); own README
  app/              pages, server actions, API routes
  lib/              domain logic: grading, engines, batching, similarity, auth
  worker/main.ts    grading worker (queue claim, auto-submit, heartbeat)
  db/NNN_*.sql      schema migrations, applied in order by `pnpm migrate`
  scripts/          migrate, create-admin, engine-check, loadtest
  deploy/           docker-compose (nginx, app, worker, db, backup, Judge0)
services/<svc>/     platform microservice; hexagonal internal layout
libs/pkg/*          shared Go: config, logging, database, messaging, authz,
                    storage (MinIO), kms (local), ratelimit, pagination, ...
libs/proto/         gRPC/protobuf contracts (source of truth for internal APIs)
web/                reserved for the platform's Next.js frontend — empty
deploy/             platform Helm + Kustomize + bare-metal bootstrap
docs/{adr,api,architecture,database,runbooks,superpowers}
```

Platform services: `gateway, identity, tenant, user, question-bank,
assessment, submission, judge, seb, notification, analytics`. Roles and
ownership per service are in `PLAN.md` §6.

### Where things go

Platform:
- Business rules → `services/<svc>/internal/domain`.
- Use cases / orchestration → `internal/app`.
- HTTP/gRPC/DB/broker code → `internal/adapters/*`, behind `internal/ports`.
- Cross-service logic → `libs/pkg/*` (never copy-paste between services).
- DB schema changes → `services/<svc>/migrations/` (golang-migrate).

Exam app:
- Pure logic with tests → `apps/exam-v1/lib/*.ts` + `lib/*.test.ts`.
- Page data loading → the page's server component; mutations → `actions.ts`
  next to the page (server actions); browser-polled JSON → `app/api/**/route.ts`.
- Background work → `worker/main.ts`.
- Schema changes → a new `apps/exam-v1/db/NNN_name.sql`. Never edit an applied
  migration; production databases already ran it.
- Deployment → `apps/exam-v1/deploy/`.

---

## Commands

> Prefer `make` targets; they wrap the canonical invocations. Run from repo root.

| Task | Command |
|---|---|
| **Exam app:** typecheck + unit tests | `make exam-check` |
| **Exam app:** production build | `make exam-build` |
| **Exam app:** start/stop the full deployment (needs `deploy/.env`, `deploy/judge0.conf`) | `make exam-up` / `make exam-down` |
| **Exam app:** dev server / worker / engine self-check / load test | `cd apps/exam-v1 && pnpm dev` · `pnpm worker` · `pnpm engine-check` · `pnpm loadtest --students N` |
| Platform: bootstrap local stack | `make dev-up` (pg, redis, nats, minio, jaeger) |
| Platform: isolated Judge control plane | `make dev-judge-up` / `make dev-judge-down` |
| Platform: tear down | `make dev-down` |
| Platform: build all services | `make build` |
| Platform: unit tests | `make test` |
| Platform: integration tests | `make test-integration` (Testcontainers; needs Docker) |
| Platform: migration checks | `make test-migrations` |
| Platform: format check | `make fmt-check` (CI gate) |
| Platform: vet / lint | `make vet` / `make lint` |
| Platform: regenerate protobuf | `make proto` (buf) |
| Platform: DB migrate | `make migrate SVC=identity DIR=up` |
| Platform: first admin | `make bootstrap EMAIL=... NAME=...` |
| Platform: rotate HMAC capability key | `make rotate-authz-key ACTION=publish\|retire ...` |
| Platform: vulnerability scan | `make vuln` (govulncheck) |

> If a target doesn't exist yet, add it to the `Makefile` rather than
> documenting a raw command here — keep this table as the single source of truth.

## Conventions

- **Go (platform):** idiomatic Go, `gofmt`/`goimports`, errors wrapped with
  `%w`, context as first arg, table-driven tests. Package names lowercase, no
  stutter.
- **TypeScript (exam app):** strict mode; server components by default,
  `"use client"` only where interactive. Tests live next to the code as
  `lib/*.test.ts` and run with `node:test` through `tsx`. Imports between
  `lib/` files use explicit `.ts` extensions so the worker and scripts run
  under `tsx` without the Next bundler.
- **APIs:** platform — REST + OpenAPI at the edge, gRPC internally; version
  breaking changes; validate with `buf breaking`. Exam app — server actions for
  form mutations, small JSON route handlers for what the exam screen polls.
- **Commits:** Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`…).
  Branch off the default branch; never commit directly to it.
- **IDs & tenancy (platform):** every tenant-scoped table has `tenant_id`;
  every request sets the tenant/actor GUC for RLS. Never bypass RLS with a
  superuser role in app code.

## Exam app conventions

These rules keep the exam app safe during a live, graded exam:

- **Authorization is server-side.** Every page calls `requireUser(...roles)`,
  every server action re-checks the role, and every student API route goes
  through `requireStudent()` + `requireOpenAttempt()` (ownership, deadline,
  network allow-list). Never trust IDs or roles from the client.
- **Hidden tests stay hidden.** Students see full input/output only for sample
  tests; hidden tests expose a verdict only. In batch grading, samples and
  hidden tests run in **separate** engine jobs so a program can never read
  hidden inputs while its output is shown (`lib/grade.ts`, `lib/batch.ts`).
- **The server owns time.** Deadlines come from `attempts.deadline_at`; the
  browser clock is display-only. Drafts are accepted for
  `DRAFT_GRACE_SECONDS` after the deadline; the worker then auto-submits the
  latest drafts.
- **Client IP is trusted only behind nginx.** `deploy/nginx.conf` overwrites
  `X-Forwarded-For`; never publish the `app` container's port directly.
- **Engines are adapters.** Add an execution engine by implementing
  `Engine.execute` (and optionally `executeBatch`) in `lib/engine.ts`; nothing
  else should know which engine runs.
- **Run `pnpm engine-check` against any new or changed engine setup** before an
  exam. It must print "Engine OK".
- `apps/exam-v1` uses Next.js 16. Its APIs differ from older versions (async
  `cookies()`/`headers()`/`params`, `agentRules` config). Check
  `node_modules/next/dist/docs/` before relying on remembered APIs.

## Platform status (read before platform work)

Done and tested: identity/MFA, tenancy, users and roles, question and
assessment authoring, attempts and answers, RLS across services, outbox/NATS
projections, list endpoints with cursor pagination, observability, Helm charts,
MinIO storage and local KMS adapters, a real Judge0 HTTP client behind the
compatibility gate (`JUDGE_ENGINE`, `JUDGE_ENGINE_COMPATIBILITY_APPROVED`),
per-test-case fan-out, and per-unit results.

**Not done — the platform cannot run an exam yet:**
- No service consumes `submission.evaluation_requested.v1` and calls the judge,
  so submissions are never graded.
- No API accepts raw source or test-case text; everything expects pre-encrypted
  objects in storage.
- The judge's `FetchQueuedJob` passes ciphertext references to the engine
  without decrypting them (Plan D Task 4 must close this).
- No bulk student import; `web/` is empty.
- Known open bugs and external gates: `Prompt.md` and `PENDING.md`.

Resume platform work from `Prompt.md` and
`docs/superpowers/plans/2026-08-24-candidate-run-code.md`.

## Definition of Done

A change is done when it compiles; lint/type checks pass; unit tests (plus
relevant integration tests) pass and were added or updated; the module
`README.md` is accurate; contracts are regenerated if touched; an ADR exists
for any decision; and no placeholder or secret is committed. For exam-app
changes that touch grading, timing or access control, also verify the flow in a
browser against a running worker, and run `pnpm engine-check` when the engine
path changed.

## Before you start a task

1. Decide which codebase the task belongs to (see the table at the top).
2. Read that codebase's `README.md`; for the platform also `PLAN.md`,
   `TASKLIST.md` and `Prompt.md`.
3. If versions or APIs of a library are involved, consult Context7 first.
4. Prefer editing existing files over creating new ones; prefer deleting code
   over adding flags.
