# Judge wrapper service

The Judge service is AetherCode's private execution control plane. It accepts
idempotent, encrypted execution references; schedules work through a durable
RabbitMQ pointer notification; and leases terminal results to the platform
submission adapter. It is not a public code-execution API and never connects to
the execution engine's database.

The dispatcher worker is off by default (`JUDGE_DISPATCHER_ENABLED=false`). When
enabled it reads admission pointers from RabbitMQ, submits each test unit to the
configured evaluation engine, polls for verdicts, and writes completion records.
The stub engine (`JUDGE_ENGINE=stub`) is available without an execution engine.
The `aethercode` engine requires `JUDGE_ENGINE_COMPATIBILITY_APPROVED=true`.

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
scores, platform foreign keys, plaintext execution material, or execution engine
credentials beyond its explicitly scoped runtime configuration.

## Interface and security

The service implements the generated `judge/v1` gRPC contract:

- `SubmitExecution` durably accepts a request after request validation and
  idempotency checking. `evaluation_bundle_key_reference` and
  `source_key_reference` (the KMS key references the bundle and the source
  object were encrypted with) are required. `request_ciphertext_ref` is
  optional: no component reads the object it points at, so callers have
  nothing meaningful to send; when present it is still validated and bound
  into the idempotency fingerprint.
- `PullCompletedExecutions` creates bounded, expiring completion leases for the
  submission-side adapter. Each leased completion also carries `unit_results`,
  one verdict/timing/`weight` entry per test unit ordered by unit number, read
  back from `judge.execution_units` — never raw stdout/stderr/expected-output
  content. `weight` (1..100) is the test's scoring weight from the evaluation
  bundle (schema v1 bundles weigh 1); Judge only reports it, scoring belongs to
  Submission.
- **Sample-test output (ADR-0021).** A bundle built with
  `evalbundle.BuildSample` marks itself `"visibility": "sample"`, and fan-out
  records that on the job (`returns_output`). For such a job only, the
  dispatcher encrypts each unit's `evalbundle.UnitOutput` (stdin, expected
  output, stdout, stderr, compile output; 64 KiB per field) with KMS, stores it
  at `judge/unit-outputs/<unit id>`, and keeps the reference, SHA-256 and key
  reference on the unit. Each `unit_results` entry then carries
  `result_ref`/`result_sha256`/`result_encryption_key_reference` (all or none).
  No other job ever produces an output object, so a run pointed at an
  evaluation or hidden bundle cannot reveal hidden output.
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

The local profile does not start the execution engine. Apply migrations with a local principal
that can assume `aether_judge_migrator`; service runtime connections use only
`aether_judge_app`. See [migrations](migrations/README.md) and the
[operations runbook](../../docs/runbooks/judge-control-operations.md).

Run service tests from the service module:

```bash
go test ./...
```

## Rate limiting

`SubmitExecution` is protected by an in-process token bucket
(`backend/libs/pkg/ratelimit`), keyed on the request's `tenant_fairness_key`. This key
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
`judge.execution_units` row per test case (see `libs/pkg/evalbundle` for the bundle
format, ADR-0014), re-encrypting and storing each test case as its own object. This
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

## Grading path

1. **Fan-out (Submit).** The bundle is decrypted with
   `evaluation_bundle_key_reference`, and each test case is re-encrypted as its
   own object; its weight is stored in `execution_units.weight`.
2. **Decrypt before dispatch.** `DispatchStoreAdapter.FetchQueuedJob` reads the
   source object (decrypting it with `execution_jobs.source_key_reference`) and
   every not-yet-submitted unit's test-case object (with the unit's
   `encryption_key_reference`), and hands the engine real `SourceCode`, `Stdin`
   and `ExpectedOutput`. Each object read is bounded to 10 MiB of ciphertext.
   Plaintext exists only in the in-memory job value; it is never logged or
   persisted. The dispatcher therefore needs `JUDGE_STORAGE_*` and
   `JUDGE_KMS_LOCAL_KEY`, and refuses to start without them.
3. **Run.** Units run sequentially in unit order. A `compile_error` on one unit
   records the remaining units as `compile_error` without running them (they
   all share one source).
4. **Completion.** `MarkJobComplete` runs in one transaction: it derives the
   overall verdict from the unit verdicts, sets the job terminal (`completed`
   when accepted, otherwise `failed`), and inserts a `judge.completed.v1` row in
   `judge.outbox_events` that `PullCompletedExecutions` leases. The payload is
   `submission_correlation_id`, `verdict`, `completed_at`, `execution_time_ms`
   (slowest unit) and `memory_kib` (largest unit); it has no encrypted result
   reference because Judge stores no result object. A unit with no recorded
   verdict counts as `internal_error`.

The overall verdict is the most severe unit verdict, mirroring exam-v1's grader:
`compile_error` > `internal_error` > `runtime_error` > `time_limit_exceeded` >
`memory_limit_exceeded` > `wrong_answer` > `accepted`. Any other unit verdict
(for example `cancelled`) is treated as `internal_error`, never as a pass.

## Dispatcher configuration

The dispatcher worker is controlled by the following environment variables. All
dispatcher variables are optional when `JUDGE_DISPATCHER_ENABLED=false`.

| Variable | Default | Description |
|---|---|---|
| `JUDGE_DISPATCHER_ENABLED` | `false` | Set to `true` to start the RabbitMQ consumer and dispatch worker. The server starts normally when false. |
| `JUDGE_ENGINE` | `stub` | Evaluation engine: `stub` (deterministic accept, no external deps) or `aethercode` (requires the compatibility approval). |
| `JUDGE_WORKER_CONCURRENCY` | `4` | Number of concurrent dispatch goroutines. Must be 1–32. |
| `JUDGE_POLL_INTERVAL_MS` | `2000` | Milliseconds between engine verdict poll attempts. |
| `JUDGE_MAX_POLL_ATTEMPTS` | `30` | Maximum poll attempts before a synthetic `internal_error` verdict is recorded (the engine never reported a terminal state — an engine/infrastructure failure, not evidence the candidate's code timed out). |
| `AETHERCODE_ENGINE_URL` | *(required when `JUDGE_ENGINE=aethercode` and the dispatcher is enabled)* | Base URL of the AetherCode Execution Engine, e.g. `http://host.docker.internal:5100`. |
| `AETHERCODE_TIMEOUT_SECONDS` | `330` | Bound on one unit: queueing, compiling and running. Must be 10–900; the engine itself gives up after five minutes. |

`JUDGE_RABBITMQ_URL`, `JUDGE_STORAGE_*` and `JUDGE_KMS_LOCAL_KEY` are also
required when `JUDGE_DISPATCHER_ENABLED=true` (RabbitMQ is already required for
the admission publisher in production/staging; storage and KMS are needed to
decrypt the source and test cases).

### The `aethercode` engine

`JUDGE_ENGINE=aethercode` (`internal/adapters/aethercode`, ADR-0028) runs units
on the AetherCode Execution Engine. Each unit is one run-mode job with the
unit's input as its only test; the adapter follows the job's Server-Sent
Events to its `VERDICT`, retries `429` with backoff, and keeps the verdict in
memory until the next `Poll` (a verdict lost to a restart is
`internal_error`). The engine never receives the expected output: the adapter
grades stdout with `dispatcher.OutputsMatch`, which normalizes line endings,
trailing whitespace per line and trailing blank lines. Language keys are the
platform's (`c`, `cpp17`, `java`, `python3`, `javascript`, `go`), mapped to the
engine's (`c`, `cpp`, `java`, `python`, `javascript`, `go`); Java, Python and
JavaScript get twice the unit's time limit. A job's pending units that share the same program are sent to the engine
as one job of up to 100 tests (`SubmitBatch`): one queue entry and one compile,
with the tests running side by side, and each unit is graded from its own
result. Units of different programs, a single pending unit, or a failed batch
fall back to one engine job per unit. A unit sent alone carries its id as the
`Idempotency-Key`, so a submit repeated after a timeout returns the engine's
original job instead of running the unit twice.

## Deployment gate

The wrapper control-plane chart requires three replicas, digest-pinned images,
mTLS client allowlisting, RabbitMQ quorum, a non-root runtime, and
deny-by-default network policy. The execution engine runs outside the cluster (ADR-0028).
Production wrapper configuration also carries the fail-closed
`JUDGE_ENGINE_COMPATIBILITY_APPROVED` value from that approval; it must be true
before the runtime starts in production. Do not claim grading availability until
the approved engine-dispatch phase has passed its compatibility and load gates.
See [ADR-0028](../../docs/adr/0028-aethercode-execution-engine.md).
