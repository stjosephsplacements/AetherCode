# ADR-0008: Isolate Judge wrapper persistence from the Judge0 engine

- Status: accepted
- Date: 2026-07-24

## Context

The platform must grade candidate code without giving an execution engine access
to platform service databases, candidate records, authorization data, or the
platform event broker. Judge0 CE owns an upstream PostgreSQL schema whose
tables and lifecycle are not a stable AetherCode contract.

## Decision

Run the wrapper control plane against its own HA database,
`aether_judge_wrapper`, and treat the Judge0 engine database as an opaque,
separately operated deployment.

The wrapper owns `execution_jobs`, `execution_units`, `dispatch_attempts`,
`language_mappings`, execution audit events, an admission outbox, terminal
completion outbox events, lease-delivery history, and an inbox deduplication
ledger. It stores opaque platform correlation IDs and encrypted object-storage
references with checksums, but no platform foreign keys, plaintext source,
tests, SEB keys, scores, or platform broker credentials.

RabbitMQ is a pointer-only admission transport. `admission_outbox` remains the
source of truth: a publisher leases a row and sends only its `event_id` and
`job_id`. Broker-confirmed pointers are replayed from the ledger after a node
failure. The foundation release has no engine dispatcher; the later approved
Judge0 phase adds a worker that re-reads the durable job and records an event ID
before it acknowledges RabbitMQ.

Terminal results leave the wrapper through private, TLS 1.3 mTLS gRPC
`PullCompletedExecutions` and `AcknowledgeCompletion`. The submission-side
adapter uses its own execute-only Submission database identity, persists a
lease-delivered completion before ACKing it, then emits the platform-owned
`judge.completed.v1` event on NATS. It validates the locally recorded
`judge_job_id` before accepting the completion. Judge does not connect to the
platform NATS broker. This implemented adapter is receive-only: it does not
call `SubmitExecution`, and it is not an admission or engine-dispatch path.

`execution_events` and append-per-lease `completion_deliveries` are monthly
partitioned high-volume history. The mutable `execution_jobs`,
`admission_outbox`, and `outbox_events` remain indexed, 30-day bounded control
tables so global UUID idempotency, an active lease, and one terminal outbox
record per job can be checked atomically without cross-partition ambiguity.

## Consequences

There are no cross-database foreign keys and no direct database connection from
the platform to Judge0. Wrapper migrations never touch Judge0's `clients`,
`languages`, or `submissions` schema. A temporary inability to reach the engine
can delay grading but cannot lose accepted work, while a stale completion ACK
cannot acknowledge a later delivery because both `delivery_id` and `lease_id`
must match the active lease. A completion whose local evaluation request does
not match the wrapper job is not acknowledged; the lease expires for safe
replay and investigation rather than creating uncorrelated platform state.
