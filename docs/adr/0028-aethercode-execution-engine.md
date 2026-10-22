# ADR-0028: The AetherCode Execution Engine runs all platform code

- Status: accepted (supersedes ADR-0018)
- Date: 2026-10-19

## Context

The platform's judge ran code on Piston (ADR-0018). The college runs its own
engine, the AetherCode Execution Engine
(github.com/stjosephsplacements/AetherCode-Execution-Engine): Go on go-judge,
with Redis queues and fair scheduling of runs and submits, already serving
the exam app on the campus server as a systemd service on port 5100. The
college wants one engine for everything.

## Decision

**Judge's `aethercode` adapter replaces Piston** (`JUDGE_ENGINE=aethercode`,
the single-server default). For each execution unit it:

1. posts `POST /api/v1/execute` in `run` mode with the unit's input as the
   only test and an empty expected output, the language mapped to the
   engine's key, the time limit scaled for Java, Python and JavaScript (x2)
   and both limits clamped to the engine's ranges; a `429` is retried with
   backoff, honouring `Retry-After`;
2. follows `GET /api/v1/stream?job_id=…` (Server-Sent Events) to the
   `VERDICT` event;
3. grades the full stdout with `dispatcher.OutputsMatch` (line endings,
   trailing whitespace and trailing blank lines are normalized).

The expected output never leaves Judge: the engine stores no test data and
needs no problem versions. Verdicts map to Judge's vocabulary
(`compilation_error` → `compile_error`, `time_limit` →
`time_limit_exceeded`, `memory_limit` → `memory_limit_exceeded`,
`output_limit` → `runtime_error`). Like Piston, `Submit` waits for the verdict
and `Poll` returns it; a verdict lost to a restart is `internal_error`, so
the unit is regraded.

**Network.** The engine has no authentication (`AC_AUTH_ENABLED=false`), so it
must never be reachable from outside the host. It listens on the docker0
address only (`AC_GATEWAY_ADDR=172.17.0.1:5100`); the exam app reaches it at
`172.17.0.1:5100`, and the judge container at `host.docker.internal:5100`
through Compose's `host-gateway`. It had listened on all interfaces and the
host firewall allows incoming traffic by default, so it was public until
this change.

The Piston adapter, the `piston` and `piston-packages` services and
`piston-packages.js` are removed. Judge migration `000012` allows
`engine_name = 'aethercode'` in `language_mappings`.

## Consequences

- One engine and one sandbox (go-judge) to operate for both apps. The engine
  caches compiled binaries, so per-test units of one submission compile once.
- The engine is a host service outside Compose: `docker compose up` does not
  start it, and its health is part of operating the stack
  (`curl http://172.17.0.1:5100/api/v1/health`).
- Judge0 remains as an option for cgroup v1 hosts (`--profile judge0`).
