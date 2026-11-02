# ADR-0060: Remove Judge0; the AetherCode Execution Engine is the only engine

- Status: accepted
- Date: 2026-11-02

## Context

ADR-0028 made the AetherCode Execution Engine (go-judge, Redis queues, cgroups
v2) the platform's engine and kept Judge0 as an option for cgroup v1 hosts. The
campus runs no cgroup v1 host, and the college operates the engine itself.
Keeping Judge0 meant a second adapter, a gVisor gate and chart, a Compose
profile, a validation suite and settings nobody used.

The engine has since become a pure executor (it no longer takes `mode` or
problem versions), returns full stdout per test, and answers a repeated
`Idempotency-Key` with the original job.

## Decision

- `JUDGE_ENGINE` accepts `stub` and `aethercode` only. The Judge0 adapter,
  its settings (`JUDGE0_BASE_URL`, `JUDGE0_TIMEOUT_SECONDS`, `JUDGE0_AUTH_TOKEN`)
  and its secret are removed. The stub moved to `internal/adapters/stub`.
- Removed: the `judge0-engine` Helm chart, kustomize and database directories,
  the `judge0-gvisor` validation suite, the Compose `judge0` profile and
  `judge0.conf`, the compatibility-gate runbook, and the Judge0 lines in the
  setup scripts and READMEs.
- The `aethercode` adapter follows the engine's current API: no `mode`, one
  test per job, and the unit id sent as `Idempotency-Key` so a unit submitted
  again after a timeout returns the original job instead of running twice. A
  `200` reply (an existing key) is accepted like a `201`.
- Expected output still never leaves Judge: the adapter compares the engine's
  stdout itself, as ADR-0028 decided.
- `JUDGE_ENGINE_COMPATIBILITY_APPROVED` stays as the operator's approval for
  enabling the dispatcher against the engine.

## Not done

- Judge migrations that mention Judge0 (`judge0_token` column, the
  `engine_name` check that still lists `judge0` and `piston`) are applied and
  stay as they are. Renaming the column is a schema change for a later
  migration.
- The frozen exam app (`apps/exam-v1`) keeps its own engine settings; it takes
  security fixes only (ADR-0017).
- ADR-0008, ADR-0009, ADR-0010, ADR-0016, ADR-0018 and ADR-0028 describe the
  past and are left as written; ADR-0009 is marked superseded.

## Consequences

- One engine to operate and test.
- A platform language still needs a mapping in the adapter; the engine also
  supports `sqlite`, which the platform does not offer.
