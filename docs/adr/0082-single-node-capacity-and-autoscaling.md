# ADR-0082: Capacity budget, autoscaling and pools for the single campus server

- Status: accepted (owner approved the plan 2026-11-17); database clusters running
- Date: 2026-11-17

## Context

AetherCode runs on k3s on one 256-core server shared with GitLab, Huly, LiteLLM and GPU LLM
workloads. The owner capped it at about 40% of the host. The Helm values had default or no
resource sizes, most HTTP services did not autoscale, every database pool defaulted to 20
connections, and the production Postgres chart assumed three hosts.

## Decision

- Three resource tiers (heavy, moderate, light) in `deploy/helm/platform-service/values-*.yaml`.
- HPA on gateway, submission, frontend, user, assessment and question-bank: 70% CPU, minimum 2,
  maximums 8, 12, 8, 6, 6 and 4, scale up at once, scale down after 300 s.
- A namespace `ResourceQuota` of 102 CPU and 120 Gi of requests is the enforced cap, not the
  limits, which exceed the host in sum by design.
- Pools: 8/2 for application pools (and user's authz pool), 2/1 for worker pools; the code default is now 8 instead of 20.
- Postgres: one CNPG instance from `deploy/single-node/postgres-cluster.yaml`.
- Proctor stays on Docker with GPU pass-through because neither GPU is free of LLM processes.

## Consequences

- The numbers and arithmetic are in `docs/runbooks/capacity-budget.md`.
- One database instance has no failover. A backup destination is required before production.
- Connections are about 96% of `max_connections = 500` at full scale; PgBouncer comes before
  any increase.
- Resolved: fresh CloudNativePG clusters hung at initdb on this node because, under the default
  AppArmor profile, PostgreSQL 18's processes lose the signals they send each other (a checkpoint
  ran only when its 5 minute timer fired and the job never finished). Setting
  `podSecurityContext.appArmorProfile` to a custom Localhost profile, `aethercode-postgres`
  (`deploy/single-node/apparmor/`, containerd's default with signals allowed), fixes it: a
  fresh cluster was healthy in 30 seconds, and the profile runs in enforce mode. It replaces
  the `Unconfined` setting first used here. The profile must be loaded on the node before the
  cluster starts. Ruled out on the way: the backup stanza, sizes, namespace, disk, THP settings, the
  image's Debian base, and PostgreSQL minor version.
