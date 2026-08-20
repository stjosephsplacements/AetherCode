# Judge wrapper service

The Judge service is AetherCode's private execution control plane. It accepts
idempotent, encrypted execution references; schedules work through a durable
RabbitMQ pointer notification; and leases terminal results to the platform
submission adapter. It is not a public code-execution API and never connects to
the upstream Judge0 PostgreSQL database.

The foundation release does **not** deploy an engine dispatcher. Production
startup fails closed until the gVisor compatibility approval is present; the
approved Judge0 phase adds the worker-side pointer consumer and dispatch flow.

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
