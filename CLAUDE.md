# CLAUDE.md

Guidance for Claude Code (and any AI assistant) working in the **AetherCode**
repository. Read this before making changes. Companion docs: `PLAN.md`
(architecture), `AGENTS.md` (agent operating rules), `TASKLIST.md` (delivery).

---

## What this project is

A multi-tenant, microservices coding-exam platform for colleges. Exams run only
inside Safe Exam Browser (SEB); the web app works in any browser. Code execution
is delegated to an **isolated** Judge0 wrapper service. Roles follow a medallion
hierarchy (Golden / Silver / Bronze). See `PLAN.md` for the full picture.

## Core principles (non-negotiable)

1. **Simplicity first.** Write the least code that satisfies the requirement.
   No speculative abstractions, no unused parameters, no dead branches.
2. **No placeholders.** Never commit `TODO`, stub bodies, fake data, or
   "implement later". If it ships, it works. If it can't ship yet, don't add it.
3. **Modular boundaries.** Respect hexagonal layers: `domain` → `app` → `ports`
   → `adapters`. Dependencies point inward only. `domain` imports no framework.
4. **Document every module.** Each service and shared lib has a `README.md`
   describing purpose, API, config, and how to run/test it. Keep it current.
5. **Best practices by default.** Security, tests, observability, and IaC are
   part of "done", not follow-ups.
6. **Latest stable versions.** Before adding or bumping any dependency, confirm
   the current stable release via the **Context7 MCP** (`resolve-library-id`
   then `query-docs`). Do not guess versions.
7. **Soft delete by default.** Only SuperAdmin can hard delete records. All other
   roles use soft delete (`deleted_at`). Queries filter soft-deleted records
   unless explicitly requesting archived data. See ADR-0013.

## Golden rules for changes

- Match the surrounding code's style, naming, and comment density.
- Change the minimum necessary. Don't reformat unrelated code.
- If a change spans a service boundary, update the `proto`/OpenAPI contract
  first, regenerate, then implement both sides.
- Any architectural decision → write an ADR in `docs/adr/` (see template there).
- Never weaken tenant isolation (RLS) or SEB/judge sandbox controls for
  convenience. Security controls are load-bearing.
- Do not commit secrets. Use env/K8s Secrets; local dev uses `.env` (gitignored).

---

## Repository map

```
services/<svc>/     one microservice; hexagonal internal layout
libs/pkg/*          shared Go: config, logging, database, messaging, authz, ...
libs/proto/         gRPC/protobuf contracts (source of truth for internal APIs)
web/                Next.js (App Router, TypeScript) frontend
deploy/             Helm + Kustomize + bare-metal bootstrap
docs/{architecture,adr,api}
```

Services: `gateway, identity, tenant, user, question-bank, assessment,
submission, judge, seb, notification, analytics`. Roles/ownership per service are
in `PLAN.md` §6.

### Where things go
- Business rules → `services/<svc>/internal/domain`.
- Use cases / orchestration → `internal/app`.
- HTTP/gRPC/DB/broker code → `internal/adapters/*`, behind `internal/ports`.
- Cross-service logic → `libs/pkg/*` (never copy-paste between services).
- DB schema changes → `services/<svc>/migrations/` (golang-migrate).

---

## Commands

> Prefer `make` targets; they wrap the canonical invocations. Run from repo root.

| Task | Command |
|---|---|
| Bootstrap local stack | `make dev-up` (pg, redis, nats, rabbitmq, minio, judge0) |
| Tear down | `make dev-down` |
| Build all services | `make build` |
| Run one service | `make run SVC=identity` |
| Unit tests | `make test` |
| Integration tests | `make test-integration` (Testcontainers) |
| Format check | `make fmt-check` (CI gate — fails on unformatted code) |
| Go vet | `make vet` |
| Lint (Go) | `make lint` (golangci-lint) |
| Regenerate protobuf | `make proto` (buf) |
| DB migrate | `make migrate SVC=identity DIR=up` |
| Frontend dev | `cd web && pnpm dev` |
| Frontend checks | `cd web && pnpm lint && pnpm test` |
| Vulnerability scan | `make vuln` (govulncheck + pnpm audit) |

> If a target doesn't exist yet, add it to the `Makefile` rather than documenting
> a raw command here — keep this table as the single source of truth.

## Conventions

- **Go:** idiomatic Go, `gofmt`/`goimports`, errors wrapped with `%w`, context
  as first arg, table-driven tests. Package names lowercase, no stutter.
- **TypeScript:** strict mode, server components by default, colocate tests.
- **APIs:** REST + OpenAPI at the edge, gRPC internally. Version breaking
  changes; validate with `buf breaking`.
- **Commits:** Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`…).
  Branch off the default branch; never commit directly to it.
- **IDs & tenancy:** every tenant-scoped table has `tenant_id`; every request
  sets the tenant/actor GUC for RLS. Never bypass RLS with a superuser role in
  app code.

## Definition of Done

A change is done when: it compiles, lint passes, unit + relevant integration
tests pass and are added/updated, the module `README.md` is accurate, contracts
are regenerated if touched, an ADR exists for any decision, and no placeholder or
secret is committed.

## Before you start a task

1. Read the relevant `PLAN.md` section and the service's `README.md`.
2. Check `TASKLIST.md` for the phase and dependencies.
3. If versions/APIs of a library are involved, consult Context7 first.
4. Prefer editing existing files over creating new ones; prefer deleting code
   over adding flags.
