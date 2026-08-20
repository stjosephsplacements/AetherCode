# ADR-0010: Use independent HA control-plane and queue clusters for Judge

- Status: accepted
- Date: 2026-07-24

## Context

At least 10,000 simultaneous candidates may submit within five minutes. An
accepted execution must survive a wrapper, database, broker, or Judge worker
node failure, and the grading target is a final-verdict P95 of 60 seconds for
the P90 real evaluation profile.

## Decision

Deploy the Judge wrapper control plane independently from both the platform
PostgreSQL cluster and the Judge0 engine database:

- a three-node Judge control-plane PostgreSQL HA deployment, with synchronous
  one-replica commit, automatic failover, encrypted India-resident WAL archive,
  and restore drills;
- a three-node RabbitMQ quorum cluster for admission, retry, and tenant-fair
  dispatch notifications;
- at least three warm wrapper replicas and, in the separately approved engine
  phase, redundant Judge workers distributed across the three Judge nodes; and
- a separate, version-pinned, India-resident HA Judge0 engine PostgreSQL/Redis
  deployment that is reachable only through the wrapper after the gVisor gate
  is approved.

Admission and terminal publication use database-backed leases. Consumers make
durable database state changes before acknowledging RabbitMQ or completion
leases, and reconcilers replay expired leases and stale published admissions.
The foundation release contains the durable publisher/reconciler only; it does
not represent an approved engine-dispatch deployment.

## Consequences

A single node loss must leave a quorum for PostgreSQL and RabbitMQ and preserve
accepted work. A failed worker can cause a bounded retry but not a lost job.
Promotion requires an exercised node-failure report, queue replay evidence,
and a PITR restore drill in addition to the latency load report.
