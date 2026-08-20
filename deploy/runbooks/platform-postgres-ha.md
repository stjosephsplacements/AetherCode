# Platform PostgreSQL HA runbook

## Preconditions

The three nodes must be independently powered and labelled
`node-role.kubernetes.io/postgres`. Their replicated storage must survive a
single node loss. CloudNativePG `1.30.x`, cert-manager, and the Barman Cloud
plugin must be healthy before this chart is applied. The object-store endpoint,
all replicas, logs, and backup keys must remain in India.

The chart requires custom server and client CAs. Workloads authenticate with
role-specific TLS client certificates only. Never enable `BYPASSRLS`, password
fallback, public database connection, or superuser application access to make a
rollout easier.

## Promotion gate

Before production promotion, record all of the following in the change ticket:

1. `kubectl get cluster aether-platform -n aethercode -o yaml` shows three
   healthy instances, `minSyncReplicas: 1`, and a distinct hostname for each.
2. A test write is visible on a synchronous standby before the client is
   acknowledged.
3. A controlled loss of the primary node promotes a replica and services resume
   without lost committed writes. Run the judge queue replay test during this
   exercise.
4. A fresh-cluster PITR restore from the India-resident object store reaches a
   timestamp selected in the drill, and application RLS tests pass against it.
5. The restore time and recovered point meet the configured recovery objectives.

Do not claim readiness from a successful Helm install alone. A failed backup,
unscheduled third instance, loss of synchronous replication, or failed restore
blocks promotion.
