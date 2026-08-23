# Judge wrapper service

The Judge service is AetherCode's private execution control plane. It accepts
idempotent, encrypted execution references; schedules work through a durable
RabbitMQ pointer notification; and leases terminal results to the platform
submission adapter. It is not a public code-execution API and never connects to
the upstream Judge0 PostgreSQL database.

The dispatcher worker is off by default (`JUDGE_DISPATCHER_ENABLED=false`). When
enabled it reads admission pointers from RabbitMQ, submits each test unit to the
configured evaluation engine, polls for verdicts, and writes completion records.
The stub engine (`JUDGE_ENGINE=stub`) is available without a Judge0 installation.
The judge0 engine requires the gVisor compatibility gate to be approved first.

## Ownership

The service owns `aether_judge_wrapper` and the `judge` schema:

- idempotent execution jobs, per-test units, dispatch attempts, and language
  mappings;
- pointer-only RabbitMQ admission state in `admission_outbox`;
- immutable execution audit events, terminal completion outbox records, and
  completion delivery leases; and
- inbound-message deduplication state.

Candidate source, hidden tests, SEB data, and large outputs are encrypted
object-storage objects referenced by checksum and key. The wrapper stores no
scores, platform foreign keys, plaintext execution material, or Judge0 engine
credentials beyond its explicitly scoped runtime configuration.

## Interface and security

The service implements the generated `judge/v1` gRPC contract:

- `SubmitExecution` durably accepts a request after request validation and
  idempotency checking.
- `PullCompletedExecutions` creates bounded, expiring completion leases for the
  submission-side adapter.
- `AcknowledgeCompletion` accepts only the exact active
  `consumer_id`/`event_id`/`delivery_id`/`lease_id` tuple after the adapter has
  persisted the result.

Terminal `judge.completed.v1` and `judge.failed.v1` outbox records are checked
at the database boundary: UUIDv7 identities, a bounded verdict, parseable UTC
completion time, non-negative bounded metrics, and an all-or-nothing encrypted
result reference/checksum/key reference are required. The Submission adapter
is receive-only; no platform component currently uses this interface to admit
new work to the wrapper.

Production and staging listen on private gRPC port `8443` with TLS 1.3 mutual
authentication. Set `JUDGE_TLS_CERT_FILE`, `JUDGE_TLS_KEY_FILE`,
`JUDGE_CLIENT_CA_FILE`, and a comma-separated
`JUDGE_ALLOWED_CLIENT_SUBJECTS`; an absent or non-allowlisted client certificate
is denied. The separate operational listener on port `8080` exposes `/healthz`
and `/readyz` only inside the workload.

## Run locally

Start only safe wrapper dependencies:

```bash
cp deploy/compose/judge-control.env.example .judge-control.env
docker compose --env-file .judge-control.env \
  -f deploy/compose/judge-control.compose.yaml up -d
```

The local profile does not start Judge0. Apply migrations with a local principal
that can assume `aether_judge_migrator`; service runtime connections use only
`aether_judge_app`. See [migrations](migrations/README.md) and the
[operations runbook](../../docs/runbooks/judge-control-operations.md).

Run service tests from the service module:

```bash
go test ./...
```

## Rate limiting

`SubmitExecution` is protected by an in-process token bucket
(`libs/pkg/ratelimit`), keyed on the request's `tenant_fairness_key`. This key
is **tenant-wide** — one whole college, not one candidate or one exam
session — so the limiter is a coarse, tenant-scoped abuse backstop, not a
fairness control: dispatch fairness across tenants is a separate concern
already handled by the judge dispatcher. It exists to catch a runaway retry
loop or a scripted flood, not to throttle legitimate exam traffic, where
dozens to hundreds of candidates in one tenant can each submit/run code many
times per hour. A rate-limited call returns `codes.ResourceExhausted`.

Because a single fixed default cannot be correct for every deployment scale,
operators must size these to their largest expected tenant's concurrent exam
load before go-live (candidate count × expected runs-per-candidate over the
busiest hour of an exam, with headroom).

| Variable | Default | Description |
|---|---|---|
| `JUDGE_SUBMIT_BURST` | 2000 | Token-bucket burst capacity (tenant-wide). |
| `JUDGE_SUBMIT_RATE` | 20000 | Refill rate, requests per hour (tenant-wide). |

## Dispatcher configuration

The dispatcher worker is controlled by the following environment variables. All
dispatcher variables are optional when `JUDGE_DISPATCHER_ENABLED=false`.

| Variable | Default | Description |
|---|---|---|
| `JUDGE_DISPATCHER_ENABLED` | `false` | Set to `true` to start the RabbitMQ consumer and dispatch worker. The server starts normally when false. |
| `JUDGE_ENGINE` | `stub` | Evaluation engine: `stub` (deterministic accept, no external deps) or `judge0` (requires gVisor gate). |
| `JUDGE_WORKER_CONCURRENCY` | `4` | Number of concurrent dispatch goroutines. Must be 1–32. |
| `JUDGE_POLL_INTERVAL_MS` | `2000` | Milliseconds between engine verdict poll attempts. |
| `JUDGE_MAX_POLL_ATTEMPTS` | `30` | Maximum poll attempts before a synthetic `time_limit_exceeded` verdict is recorded. |

`JUDGE_RABBITMQ_URL` is also required when `JUDGE_DISPATCHER_ENABLED=true` (it
is already required for the admission publisher in production/staging).

## Deployment gate

The wrapper control-plane chart requires three replicas, digest-pinned images,
mTLS client allowlisting, RabbitMQ quorum, a non-root runtime, and
deny-by-default network policy. The separate `judge0-engine` chart remains
disabled until the gVisor compatibility gate has produced approved evidence.
Production wrapper configuration also carries the fail-closed
`JUDGE_ENGINE_COMPATIBILITY_APPROVED` value from that approval; it must be true
before the runtime starts in production. Do not claim grading availability until
the approved engine-dispatch phase has passed its compatibility and load gates.
See [ADR-0009](../../docs/adr/0009-judge0-gvisor-compatibility-gate.md) and
[`deploy/validation/judge0-gvisor`](../../deploy/validation/judge0-gvisor).
