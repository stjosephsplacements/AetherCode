# Capacity budget on the campus server

AetherCode may use about 40% of the 256-core, 512 GB server (GitLab, Huly, LiteLLM, monitoring
and the GPU LLM workloads keep the rest). Memory is not the tight resource here: 40% of the host
is about 200 GB and the budget below needs about 102 Gi. CPU is the binding limit.

Measured on 2026-11-17 (read only): node usage 8 cores / 115 GB, pod requests 30 cores / 78 GB,
pod limits 200 cores / 280 GB (already 80% overcommitted by other workloads).

## Services and tiers

| Service | Role | Profile | Tier (request / limit) | Replicas | DB pools (max/min per pod) |
|---|---|---|---|---|---|
| gateway | Edge routing, JWT validation, SSE | I/O, CPU for TLS and JWT | heavy: 2 CPU, 2Gi / 6 CPU, 4Gi | 2–8 HPA | none |
| submission | Attempts, code runs, snapshots | Hot writes, stateful DB | heavy | 2–12 HPA | app 8/2, projection 2/1, expiry 2/1, judge adapter 2/1 |
| user | Accounts, RBAC, authorization decisions | I/O, on every request's path | heavy | 2–6 HPA | app 8/2, authz 8/2, projection 2/1 |
| assessment | Exams, assignments | Read-mostly | moderate: 1 CPU, 1Gi / 3 CPU, 2Gi | 2–6 HPA | app 8/2, projection 2/1 |
| question-bank | Problems, test data | Read-mostly | moderate | 2–4 HPA | app 8/2, projection 2/1 |
| frontend | Next.js SSR and BFF | CPU (rendering) | moderate | 2–8 HPA | none |
| analytics | Talent cards, rollups | Batch, bursty | moderate | 2 | app 8/2, projection 2/1 |
| identity | Login, password hashing, SSO | CPU bursts (hashing) | light: 0.5 CPU, 512Mi / 2 CPU, 1Gi | 2 | app 8/2, projection 2/1 |
| seb | Safe Exam Browser keys, launch tickets | Light | light | 2 | app 8/2, projection 2/1 |
| tenant | Colleges | Light | light | 2 | app 8/2, projection 2/1 |
| notification | Email, announcements | Light, I/O | light | 2 | app 8/2, projection 2/1, retention 2/1 |
| judge | Evaluation dispatch | Stateful, own DB | unchanged (0.5 CPU, 512Mi / 2 CPU, 2Gi) | 3 | own database |
| proctor | YOLOv8x and MediaPipe on CUDA | GPU | not on Kubernetes (see GPU) | – | – |

HPA: target 70% CPU, scale up at once by 100% or 4 pods every 15 s, scale down after a 300 s
window by at most 50% a minute. Question-bank's maximum of 4 was chosen to fit the budget.

## Requests at full scale (what the quota caps)

| | CPU | Memory |
|---|---|---|
| submission 12 × 2 | 24 | 24 Gi |
| gateway 8 × 2 | 16 | 16 Gi |
| user 6 × 2 | 12 | 12 Gi |
| assessment 6, question-bank 4, frontend 8, analytics 2 (× 1) | 20 | 20 Gi |
| identity, seb, tenant, notification (2 × 0.5 each) | 4 | 4 Gi |
| judge 3 × 0.5 | 1.5 | 1.5 Gi |
| Postgres (1 instance) | 16 | 24 Gi |
| **Total** | **93.5** | **101.5 Gi** |
| Quota (`deploy/single-node/resource-quota.yaml`) | 102 | 120 Gi |

About 8 CPU of headroom remains for rolling updates (maxSurge 1 per deployment). Roll services
one at a time. Limits sum to about 262 CPU and 190 Gi at full scale: that is burst capacity, not
a promise, and CPU limits will throttle a busy pod before it takes a neighbour's cores.

## Postgres connections

Worst case per pod is shown in the services table. At full scale: submission 12 × 14 = 168, user
6 × 18 = 108, assessment 6 × 10 = 60, question-bank 4 × 10 = 40, and the two-replica services
about 104 (identity 20, tenant 20, seb 20, notification 24, analytics 20). That is about 480 of
`max_connections = 500`, plus one surge pod during a rollout. It is tight. If the HPA maximums
or pool sizes grow, put PgBouncer (the CNPG Pooler) in front before raising them.
`user`'s authz pool is sized like an app pool because every request's authorization reads it.

## Database

`deploy/helm/platform-postgres-ha` assumes three hosts and cannot schedule on this one node. Use
`deploy/single-node/postgres-cluster.yaml` (1 instance, 16/24 CPU, 24/32 Gi, `shared_buffers=16GB`,
`work_mem=32MB`, `max_connections=500`, volume class `local-production`, which keeps the data when
a Cluster is deleted; `local-path` would delete it). One instance means no failover: backups and
the volume are the safety net, so configure a real backup destination before production.

Both clusters (`aethercode-dev` 2/4 CPU, `aethercode-prod` 16/24 CPU) are running from this manifest. It needs
`appArmorProfile: Unconfined` on this node, or the initdb job hangs; see ADR-0082.

## GPU

Both GPUs carry host LLM processes (GPU 0: ollama 18 GB; GPU 1: unsloth llama-server 50 GB of
98 GB each). Neither is free of them, so proctor stays outside Kubernetes with device
pass-through, and its values file is not installed here. Kubernetes cannot see those processes,
so a pod requesting `nvidia.com/gpu` could land on a GPU the LLMs already fill.
