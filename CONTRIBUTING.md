# Contributing to AetherCode

Thanks for helping. AetherCode runs graded exams, so correctness and security
come before features. Please read this first.

## Where to work

| Codebase | Accepts |
|---|---|
| Platform (`backend/`, `deploy/`, `frontend/`) | Features, fixes, docs, tests. All new work goes here. |
| Exam app v1 (`apps/exam-v1/`) | Security fixes only. It is a frozen fallback (ADR-0017). |

The [roadmap](docs/roadmap.md) lists what is next; [PLAN.md](PLAN.md) is the
architecture. Open an issue to discuss anything larger than a bug fix before
you write it.

## Ground rules

- **Working code only.** No `TODO`s, stubs, placeholder data or "implement
  later". If it can't ship yet, leave it out.
- **Least code that works.** No speculative abstractions or unused
  parameters. Match the surrounding style, naming and comment density.
- **Hexagonal services.** Business rules in `internal/domain`, use cases in
  `internal/app`, HTTP/gRPC/DB/broker code in `internal/adapters`. `domain`
  imports no framework; shared logic goes in `backend/libs/pkg`, never
  copied between services.
- **Security controls are load-bearing.** Don't weaken row-level security,
  signed authorization capabilities, the judge sandbox, SEB enforcement or the
  hidden-test boundary for convenience.
- **Contracts first.** A change across a service boundary updates the
  `proto`/OpenAPI contract first, then both sides.
- **Decisions get an ADR.** Architectural choices go in `docs/adr/` using the
  template there.
- **Migrations are append-only.** Never edit an applied migration; add a new
  paired `up`/`down` migration.
- **Soft delete by default** (ADR-0013); only a super admin hard-deletes.
- **No secrets** in code, tests or docs. Local configuration lives in
  gitignored `.env` files.
- **Dependencies:** use the latest stable release and check it on the
  registry; don't guess versions.

## Before you open a pull request

From the repository root:

```sh
make fmt-check vet build test       # always
make lint                           # needs golangci-lint
make test-integration               # needs Docker; for database or adapter changes
make test-migrations                # for migration changes
make exam-check                     # for apps/exam-v1 changes
```

A change is done when it builds, lint and tests pass, tests were added or
updated, the module `README.md` is accurate, contracts are regenerated if
touched, and an ADR exists for any decision.

## Commits and pull requests

- [Conventional Commits](https://www.conventionalcommits.org/): `feat:`,
  `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
- One logical change per pull request, with a description of what changed,
  why, and how you tested it.
- Commits are authored by you. Don't add AI-assistant `Co-Authored-By`
  trailers or "generated with" lines.

## Reporting security issues

Never in a public issue. See [SECURITY.md](SECURITY.md).

## License

AetherCode is copyright St. Joseph's Group of Institutions and licensed under
the [GNU AGPL v3](LICENSE) (see [NOTICE](NOTICE)). By contributing you agree
that your contributions are licensed under the same license.
