# Production Readiness Roadmap

Date: 2026-08-20
Status: active
Audit: published backend ledger, 2026-08-20 (finding IDs referenced throughout)

## What "ready" means here, and what it cannot mean

This roadmap tracks **repository-owned** work: everything that can be built,
tested, and verified from inside this repo. Completing all of it does not make
the platform production-ready, and no entry here should be read as claiming
that.

Production readiness for an exam platform additionally requires evidence that
cannot be produced from source:

| Gate | Why code cannot close it |
|---|---|
| Judge0 under gVisor (EXT-1) | Requires running the pinned image under the approved sandbox and recording the result |
| India-resident KMS + object storage (EXT-2) | Requires an approved key controller and bucket with scoped workload identity |
| Notification provider (EXT-3) | Requires an approved provider, residency path, and retention terms |
| HA topology, load evidence, security review (EXT-4) | Requires real hardware, a real burst, and human reviewers |

The honest formulation: this roadmap drives the platform to **"every
repository-owned gap closed, and every external gate reduced to the smallest
possible external step."** That second clause matters — several EXT items have
an in-repo half that can be finished now, so that when approval lands the
remaining work is configuration rather than construction.

## Principle: build the in-repo half of blocked work

PENDING.md treats EXT-1 and EXT-2 as wholly blocked. They are not.

- **EXT-1 (Judge0/gVisor).** The dispatcher, worker, token reconciliation, retry
  and fairness logic are ordinary code. They can be written and unit-tested
  against a fake engine behind a port. The gate blocks *enabling* the real
  engine, not *writing* the adapter.
- **EXT-2 (KMS/object storage).** The storage port and a MinIO-backed adapter
  can be built and tested against local compose. The gate blocks choosing the
  production backend, not defining the boundary.

Both are therefore scheduled as in-repo work, with the external dependency
isolated behind a port and disabled by default.

## Sub-projects

Ordered by unblocking value per unit of effort. Each produces working, testable
software on its own and gets its own spec, plan, and execution cycle.

| # | Sub-project | Closes | Status |
|---|---|---|---|
| A | Version control baseline | OPS-3 | **done** — baseline commit, working branch |
| A2 | CI gate repairs | CI-1..CI-4 | **done** — all five gates green |
| C | Read surface + cursor pagination | API-1 | **in progress** — 16 endpoints |
| D | Bootstrap + attempt expiry workers | EXEC-5, EXEC-4 | planned |
| B | Object storage port + MinIO adapter | EXEC-2, half of EXT-2 | planned |
| E | Observability: request ID, OTel, real metrics | OBS-1, OBS-2, OBS-3 | planned |
| F | Integration harness (testcontainers) | TEST-1, TEST-2 | planned |
| J | Judge dispatcher against a fake engine | half of EXEC-1, half of EXT-1 | planned |
| G | Authorization capacity work | PERF-1, TEST-3 | planned — needs E and F first |
| H | Helm charts for eleven services | OPS-1 | planned |
| K | Remaining API surface: updates, bulk, audit reads | API-2, API-3, SEC-3 | planned |
| L | Hardening: quotas, registration limits, key rotation | API-4, SEC-1, SEC-4, OBS-4, OBS-5 | planned |
| M | Proctoring runtime | EXEC-6 | planned |
| N | Candidate run-code path | EXEC-7 | planned — depends on J |
| O | Image pipeline: build, sign, SBOM | OPS-2 | planned |

## Ordering constraints

These are real dependencies, not preferences:

- **E before G.** A load test without tracing produces a number and no
  diagnosis. Instrument first.
- **F before G.** Changing the authorization model safely requires a harness
  that proves RLS isolation still holds afterwards.
- **F before any RLS policy change.** Sub-project C deliberately defers making
  the SELECT policies owner-aware for exactly this reason.
- **J before N.** The candidate run-code path needs a dispatcher to call.
- **H before EXT-4.** Node-loss and PITR drills cannot be attempted while the
  services have no deployment manifests.
- **B before question content is usable end to end.** Nothing can serve a
  question statement until the storage port exists.

## Definition of done per sub-project

A sub-project is done when: it compiles; `make build`, `test`, `vet`,
`fmt-check`, `lint`, and `test-migrations` all pass; unit and — once F lands —
integration tests are added and pass; every module README is accurate; contracts
are regenerated if touched; an ADR exists for any architectural decision; and no
placeholder or secret is committed.

The `lint` and `vuln` gates additionally require `golangci-lint`, `buf`, and
`govulncheck`, which are absent from the current machine (TEST-4). Installing
them is a prerequisite of the first sub-project that claims those gates.

## Reporting rule

Progress is reported against gates actually run on the tree, never against this
document's own checkboxes. Where a checklist and the code disagree, the code is
what gets reported. TASKLIST.md claimed migration verification was delivered
while it failed on the third database — that failure mode is what this rule
exists to prevent.
