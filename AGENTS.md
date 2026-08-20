# AGENTS.md

Operating rules for autonomous/AI agents contributing to **AetherCode**. This
follows the [agents.md](https://agents.md) convention and complements
`CLAUDE.md` (which holds the same principles for interactive Claude Code use).
When guidance overlaps, `CLAUDE.md` and this file must stay in sync.

---

## Project snapshot

Multi-tenant coding-exam platform · Go microservices · Next.js frontend ·
PostgreSQL (RLS multi-tenancy) · isolated Judge0 wrapper · SEB-enforced exams ·
Kubernetes on bare metal. Full context in `PLAN.md`.

## Prime directives

1. **Ship working code only** — no placeholders, stubs, mock data, or `TODO`s.
2. **Keep it simple** — least code that meets the requirement; delete before you
   add.
3. **Stay in your lane** — respect hexagonal boundaries and service ownership
   (`PLAN.md` §6). Do not reach across a service's data directly; use its API.
4. **Verify versions with Context7** — never invent a version or an API. Use
   `resolve-library-id` → `query-docs` before adding/upgrading dependencies.
5. **Document as you go** — update the module `README.md` and add an ADR for any
   decision.
6. **Never weaken security controls** — RLS tenant isolation, SEB key
   validation, and Judge0 sandboxing are load-bearing; do not relax them.

## Build / test / validate

Run from the repo root; use `make` targets (see `CLAUDE.md` → Commands):

```
make dev-up            # local dependencies
make build             # compile all services
make test              # unit
make test-integration  # Testcontainers-backed
make lint              # golangci-lint
make proto             # regenerate gRPC/protobuf
make vuln              # govulncheck + pnpm audit
```

Frontend: `cd web && pnpm install && pnpm dev | pnpm lint | pnpm test`.

An agent must run `make lint test` (plus `test-integration` when touching
adapters) before proposing a change as complete.

## Boundaries & safety

- **Allowed without asking:** reading code, running tests/lint/build, editing
  within a single service, writing docs/ADRs, generating from contracts.
- **Ask/confirm first:** schema/migration changes, contract-breaking API edits,
  cross-service changes, dependency additions/upgrades, anything touching auth,
  RLS, SEB, or the judge sandbox, and any deploy/IaC change.
- **Never:** commit secrets, disable security controls, push to the default
  branch, run destructive commands against real data, or introduce a network
  path out of the judge sandbox.

## Definition of Done

Compiles · lint clean · unit + relevant integration tests pass and are updated ·
module `README.md` accurate · contracts regenerated if touched · ADR written for
any decision · no placeholders · no secrets · scoped to the task.

## Contract-first workflow (cross-service work)

1. Update `libs/proto/*.proto` (or the service `api/openapi.yaml`).
2. `make proto`; check `buf breaking`.
3. Implement provider, then consumers.
4. Add/adjust contract + integration tests.

## Handoff notes

When finishing, summarize: what changed, which services/contracts were touched,
new/updated ADRs, migrations added, and any follow-ups. Reference files as
`path:line`. Leave `TASKLIST.md` checkboxes updated for completed items.
