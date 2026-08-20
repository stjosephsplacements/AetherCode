# Judge control-plane operations

## Scope and ownership

This runbook covers the private Judge wrapper and its
`aether_judge_wrapper` control database. It does not authorize direct access to
the upstream Judge0 PostgreSQL database. The wrapper database contains opaque
execution references and checksums; candidate source, hidden tests, SEB keys,
and large results stay encrypted in object storage.

The wrapper exposes mTLS gRPC on port `8443`. Its unauthenticated operational
health and readiness listener is port `8080` inside the workload only; the
Helm service deliberately exposes no external health endpoint.

The foundation release has no Judge0 dispatcher worker. Production runtime
startup requires a true `JUDGE_ENGINE_COMPATIBILITY_APPROVED` value, and engine
work remains a blocked release phase until the gVisor gate, worker dispatch,
node-failure, and load evidence are approved.

## Deploy and migrate

1. Provision non-login database group roles and a separate application login
   using [`deploy/database/judge-control/roles.sql`](../../deploy/database/judge-control/roles.sql).
   The migration login must be able to `SET ROLE aether_judge_migrator`; the
   wrapper login receives only `aether_judge_app`.
2. Apply migrations with the service migration runner before deploying a
   wrapper version that uses them. Never run wrapper migrations against the
   Judge0 engine database.
3. Set the wrapper runtime secret, TLS Secret, RabbitMQ secret, image digest,
   and `tls.allowedClientSubjects`. The Helm chart refuses to render without
   them. TLS files are mounted group-readable only to the non-root wrapper
   group (`fsGroup` 65532). It also requires either its
   managed three-node CNPG configuration or an immutable external-HA evidence
   reference; a single-node runtime URL is not an accepted production path.
4. Confirm all three wrapper Pods are Ready, the three RabbitMQ members form a
   quorum, and the control-plane PostgreSQL cluster has a synchronous replica
   before accepting production traffic.

## Admission and replay

`SubmitExecution` is successful only after one transaction writes an
idempotent `execution_jobs` row, its audit event, and an `admission_outbox` row.
The RabbitMQ publisher leases pending rows; the AMQP notification contains only
the immutable `event_id` and `job_id`, never execution material. A worker loads
the job from PostgreSQL and encrypted object storage, records durable
consumption, then acknowledges RabbitMQ **only in the approved engine-dispatch
phase**. In the foundation release, the publisher reconciles stale `published`
pointers back to `pending` without claiming that an engine consumed them.

For an admission backlog or a failed publisher, inspect the pointer ledger:

```sql
SELECT state, count(*)
FROM judge.admission_outbox
GROUP BY state
ORDER BY state;

SELECT event_id, job_id, state, available_at, lease_owner, lease_expires_at,
       publish_attempt_count, last_publish_error
FROM judge.admission_outbox
WHERE state IN ('pending', 'leased', 'published')
ORDER BY available_at
LIMIT 100;
```

Do not manually publish source, tests, or request payloads to RabbitMQ and do
not delete a lease to "unstick" a job. Run the versioned publisher/reconciler:
expired publisher leases and stale `published` rows are re-leased or replayed
idempotently from PostgreSQL. If the reconciler is unavailable, stop admission
when the queue SLO is at risk and restore it rather than bypassing the durable
ledger.

## Terminal completion delivery

The receive-only Submission completion bridge calls `PullCompletedExecutions`,
persists every completion idempotently through the dedicated
`aether_submission_judge_adapter` database identity, emits its platform event,
then calls `AcknowledgeCompletion`. It requires private mTLS and never calls
`SubmitExecution`. An ACK must have the exact `consumer_id`, `event_id`,
`delivery_id`, and `lease_id`; a stale or duplicate ACK is intentionally
rejected.

The bridge accepts a completion only if the local evaluation request already
contains the same `judge_job_id`. An unknown or mismatched job is a fail-closed
ingress error: do not force an ACK or create a substitute record. Let the lease
expire, inspect the wrapper terminal event and Submission dispatch correlation,
then correct the approved admission path before retrying.

```sql
SELECT state, count(*)
FROM judge.outbox_events
GROUP BY state
ORDER BY state;

SELECT delivery_id, event_id, consumer_id, lease_id, leased_at,
       lease_expires_at, acknowledged_at
FROM judge.completion_deliveries
WHERE acknowledged_at IS NULL
ORDER BY lease_expires_at
LIMIT 100;
```

If the submission adapter fails, let the lease expire and pull again. Do not
mark an outbox row acknowledged without proof that the submission service has
durably stored the completion.

## Failure response and recovery

- **One wrapper or approved-phase worker node lost:** keep at least two
  remaining PostgreSQL and RabbitMQ members healthy, wait for expired leases,
  then verify replay from `admission_outbox` and `outbox_events`. Preserve logs
  and broker quorum evidence for the failure exercise.
- **RabbitMQ quorum unavailable:** accepted rows remain in PostgreSQL. Stop
  new acceptance once the 2-second acceptance SLO cannot be met; restore a
  quorum and replay from the admission ledger. Never substitute an in-memory
  queue.
- **Control PostgreSQL failover:** do not force a failover while a synchronous
  replica is unavailable. After automatic failover, verify the migration
  version, wrapper readiness, expired leases, and replication/WAL archival
  health before reopening admission.
- **Judge0 engine unavailable:** do not bypass the compatibility gate. In the
  approved dispatch phase, leave jobs durable and retry through its
  dispatch/reconciliation path. Do not connect a platform service directly to
  the engine database or weaken the gVisor/network boundary to restore speed.

## Retention and evidence

Only the migration role may run the wrapper purge function. It rejects a cutoff
newer than 30 days; run it after checking the approved retention/legal-hold
workflow, and retain purge counts in the operational audit trail. The purge
expires stale outbox leases, removes old partitioned completion-delivery
history before referenced outbox rows, then removes terminal wrapper control
data. It is not a mechanism for deleting submission-owned academic records or
object-storage evidence. Mutable jobs and active outbox/admission lease state
are intentionally indexed 30-day control tables rather than partitions; do not
attempt manual partition maintenance for them.

Run the monthly partition task before the pre-created horizon is exhausted:

```sql
SELECT judge.create_execution_events_partition(
  date_trunc('month', CURRENT_DATE + INTERVAL '2 months')::date
);
SELECT judge.create_completion_deliveries_partition(
  date_trunc('month', CURRENT_DATE + INTERVAL '2 months')::date
);
```

Promotion evidence must include a successful restore drill, a node-failure and
queue-replay exercise, and the 10,000-candidate/five-minute load report with
final-verdict P95 at or below 60 seconds.
