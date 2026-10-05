# AGENTS.md

Operating rules for autonomous/AI agents contributing to **AetherCode**. This
follows the [agents.md](https://agents.md) convention and complements
`CLAUDE.md` (the same principles for interactive Claude Code use). When
guidance overlaps, `CLAUDE.md` and this file must stay in sync.

---

## Project snapshot

A coding-exam platform for colleges, in two independent codebases:

- **`apps/exam-v1/` — the exam app in use.** Next.js 16 + PostgreSQL + a
  grading worker over Judge0 (or Piston), deployed with Docker Compose behind
  nginx on one campus server. It covers CSV student import, question and exam
  authoring with question pools, a HackerRank-style exam screen (Run/Submit,
  per-test results, auto-submit at time-up), lab lockdown, a live monitor,
  announcements, result release, a similarity report and CSV export. See
  `apps/exam-v1/README.md` and ADR-0016.
- **`backend/services/`, `backend/libs/`, `deploy/` — the long-term platform.** Multi-tenant
  Go microservices with PostgreSQL RLS, an isolated Judge0 wrapper,
  SEB-enforced exams, Docker Compose on one server or Kubernetes. Accounts,
  authoring, take-and-grade and SEB lockdown work end to end through the
  gateway (milestones M0–M4); `frontend/` is not started. Full context in
  `PLAN.md`; current state and remaining milestones in `docs/roadmap.md`.

The two share no code or database. Never couple them. Per ADR-0017 the Go
platform is the only backend going forward: `apps/exam-v1` is a **frozen
fallback** (security fixes only) whose README and e2e spec are the
behavioural reference for the port in
`docs/roadmap.md`.

## Prime directives

1. **Ship working code only** — no placeholders, stubs, mock data, or `TODO`s.
2. **Keep it simple** — least code that meets the requirement; delete before
   you add.
3. **Stay in your lane** — platform: respect hexagonal boundaries and service
   ownership (`PLAN.md` §6) and never reach into another service's data; exam
   app: logic in `lib/`, page data in server components, mutations in server
   actions, background work in `worker/`.
4. **Verify versions** — never invent a version or an API. Use Context7
   (`resolve-library-id` → `query-docs`) before adding or upgrading
   dependencies, or the package registry if Context7 is unavailable. Respect the
   exam app's pnpm `minimumReleaseAge` policy.
5. **Document as you go** — update the module `README.md` and add an ADR for any
   decision.
6. **Never weaken security controls** — they are load-bearing. Platform: RLS
   tenant isolation, SEB key validation, Judge0 sandboxing. Exam app:
   server-side role and attempt checks, hidden tests never shown or exposed to
   sample runs, server-owned deadlines, the nginx-overwritten client IP.

## Build / test / validate

Run from the repo root; use `make` targets (see `CLAUDE.md` → Commands):

```
make exam-check        # exam app: typecheck + unit tests
make exam-build        # exam app: production build
make exam-up           # exam app: full Docker Compose deployment
make dev-up            # platform: local dependencies
make build             # platform: compile all services
make test              # platform: unit
make test-integration  # platform: Testcontainers-backed
make lint              # platform: golangci-lint
make proto             # platform: regenerate gRPC/protobuf
make vuln              # platform: govulncheck
```

Exam app, inside `apps/exam-v1`: `pnpm dev`, `pnpm worker`, `pnpm migrate`,
`pnpm engine-check` (must print "Engine OK"), `pnpm loadtest --students N`.

Before proposing a change as complete:
- **Platform:** run `make lint test`, plus `test-integration` when touching
  adapters.
- **Exam app:** run `make exam-check exam-build`. If you changed grading,
  timing, access control or the exam screen, also exercise the flow in a
  browser against a running worker. If you changed the engine path, run
  `pnpm engine-check`.

## Boundaries & safety

- **Allowed without asking:** reading code, running tests/lint/build, editing
  within a single service or within the exam app, writing docs/ADRs, generating
  from contracts.
- **Ask/confirm first:**
  - schema or migration changes, contract-breaking API edits, cross-service
    changes, dependency additions or upgrades;
  - anything touching auth, RLS, SEB, the judge sandbox, grading or scoring
    rules, or exam timing;
  - any deploy or IaC change;
  - anything that modifies or deletes data in a database holding real exam
    results.
- **Never:** add AI attribution to commits, PRs or comments (no
  `Co-Authored-By:` trailers, no "Generated with" lines; commits are authored by
  the repository owner only), commit secrets, disable security controls, push to the default
  branch, run destructive commands against real data, introduce a network path
  out of the judge sandbox, edit an already-applied exam-app migration, or
  publish the exam app's `app` container port instead of nginx.

## Definition of Done

Compiles · lint/type checks clean · unit + relevant integration tests pass and
are updated · module `README.md` accurate · contracts regenerated if touched ·
ADR written for any decision · no placeholders · no secrets · scoped to the
task.

## Contract-first workflow (platform cross-service work)

1. Update `backend/libs/proto/*.proto` (or the service `api/openapi.yaml`).
2. `make proto`; check `buf breaking`.
3. Implement provider, then consumers.
4. Add/adjust contract + integration tests.

## Handoff notes

When finishing, summarize:
- what changed;
- which codebase, services and contracts were touched;
- new or updated ADRs and migrations added;
- any follow-ups.

Reference files as `path:line`. Update the milestone table in
`docs/roadmap.md` when platform work completes.
