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
- `DeleteExecutionJob` soft-deletes an execution job (`deleted_at`), retaining
  it with an audit trail.
- `HardDeleteExecutionJob` permanently removes an execution job. Callers must
  restrict this to SuperAdmin; the RPC itself performs no role check.

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

## Test-case fan-out configuration

`SubmitExecution` fans a submission's evaluation bundle out into one
`judge.execution_units` row per test case (see `internal/bundle` for the bundle
format), re-encrypting and storing each test case as its own object. This
requires object storage and a KMS key manager to be configured; both are
optional at the process level, but when either is absent, `Submit` fails
clearly with `app.ErrFanOutUnavailable` (mapped to `codes.FailedPrecondition`)
rather than silently admitting a job with zero units.

| Variable | Default | Description |
|---|---|---|
| `JUDGE_STORAGE_ENDPOINT` | *(required for fan-out)* | MinIO/S3-compatible endpoint used to store per-test-case encrypted objects. |
| `JUDGE_STORAGE_BUCKET` | *(required for fan-out)* | Bucket that receives per-test-case encrypted objects. |
| `JUDGE_STORAGE_ACCESS_KEY` | *(required for fan-out)* | Access key for `JUDGE_STORAGE_ENDPOINT`. |
| `JUDGE_STORAGE_SECRET_KEY` | *(required for fan-out)* | Secret key for `JUDGE_STORAGE_ENDPOINT`. |
| `JUDGE_KMS_LOCAL_KEY` | *(required for fan-out)* | Base64-standard-encoded 32-byte AES-256-GCM key used to decrypt the evaluation bundle and re-encrypt each test case. Local/dev/CI only — production must use a managed KMS provider. |

All five are unset by default, which disables fan-out: `Submit` still validates
and accepts jobs (matching a deployment that never calls `Submit`, e.g. an
instance serving only `Pull`/`Acknowledge`), but any `Submit` call fails with
`FailedPrecondition` instead of creating a job with no execution units.

## Dispatcher configuration

The dispatcher worker is controlled by the following environment variables. All
dispatcher variables are optional when `JUDGE_DISPATCHER_ENABLED=false`.

| Variable | Default | Description |
|---|---|---|
| `JUDGE_DISPATCHER_ENABLED` | `false` | Set to `true` to start the RabbitMQ consumer and dispatch worker. The server starts normally when false. |
| `JUDGE_ENGINE` | `stub` | Evaluation engine: `stub` (deterministic accept, no external deps) or `judge0` (requires gVisor gate). |
| `JUDGE_WORKER_CONCURRENCY` | `4` | Number of concurrent dispatch goroutines. Must be 1–32. |
| `JUDGE_POLL_INTERVAL_MS` | `2000` | Milliseconds between engine verdict poll attempts. |
| `JUDGE_MAX_POLL_ATTEMPTS` | `30` | Maximum poll attempts before a synthetic `internal_error` verdict is recorded (the engine never reported a terminal state — an engine/infrastructure failure, not evidence the candidate's code timed out). |
| `JUDGE0_BASE_URL` | *(required when `JUDGE_ENGINE=judge0` and the dispatcher is enabled)* | Base URL of the Judge0 HTTP API the `judge0` engine submits to and polls. Not required for any other engine or deployment, even when `JUDGE_ENGINE_COMPATIBILITY_APPROVED=true` — that flag is independently required in production/staging regardless of engine choice. |
| `JUDGE0_TIMEOUT_SECONDS` | `10` | Per-request HTTP timeout for the Judge0 client. Must be 1–120. |
| `JUDGE0_AUTH_TOKEN` | *(optional)* | Bearer/auth token forwarded to Judge0 as `X-Auth-Token` on every request. Leave unset for a local/dev Judge0 instance with no auth configured. |

`JUDGE_RABBITMQ_URL` is also required when `JUDGE_DISPATCHER_ENABLED=true` (it
is already required for the admission publisher in production/staging).

### The `judge0` engine

`JUDGE_ENGINE=judge0` constructs a real HTTP client (`internal/adapters/judge0`)
that submits test units to a Judge0 instance at `JUDGE0_BASE_URL` and polls for
verdicts. It is gated behind `JUDGE_ENGINE_COMPATIBILITY_APPROVED=true`: with the
gate unset, the dispatcher logs a warning and does not start, matching the
`stub` engine's off-by-default posture. `JUDGE0_BASE_URL` is only required in
this specific case (dispatcher enabled, `JUDGE_ENGINE=judge0`, gate approved) —
`internal/adapters/judge0.NewClient` rejects an empty or invalid base URL when
the client is constructed, so no deployment that does not actually select the
`judge0` engine is forced to set it.

This client is not end-to-end functional yet: nothing in the judge service
currently decrypts and fetches the actual source code or test case content
referenced by the ciphertext refs a dispatch job carries (that decrypt/fetch
step is separate, tracked work, not part of this adapter). `Submit` fails
loudly with a clear error on an empty source rather than submitting an empty
program to Judge0, so even with a real, reachable Judge0 instance and the
compatibility gate approved, submissions will fail this validation rather than
silently grading garbage. This is a known, sequenced gap, not a bug in the
client itself.

Judge0's own default execution limits (commonly `max_cpu_time_limit` around
15 seconds and `max_memory_limit` around 128 MB) are lower than this
platform's configured maximums (this service's migrations allow up to 60000ms
CPU time and 2GiB memory). An operator deploying a real Judge0 instance needs
to raise Judge0's own limits to match, or over-limit jobs will fail with a 422
from Judge0 — which the client already surfaces as a clear error, not a
silent failure, but is worth planning for ahead of go-live.

This adapter's request/response handling is covered by `httptest`-mocked unit
tests only. It has not been live-validated against a real Judge0 deployment —
per the [deployment gate](#deployment-gate) above, no Judge0 instance may be
added to the local compose stack until the gVisor compatibility evidence suite
is approved. Do not treat `JUDGE_ENGINE_COMPATIBILITY_APPROVED=true` as
production sign-off by itself; it must be backed by that approved evidence.

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
