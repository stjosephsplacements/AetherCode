# External completion gates

This file records work that cannot be truthfully completed from this repository
alone. It is not a list of code placeholders: each item requires an approved
external system, credential, environment, or production exercise. The backend
must remain fail closed until the relevant acceptance evidence exists.

## Required external authority or environment

- **India-resident platform HA deployment:** provision three independently
  powered PostgreSQL nodes, encrypted India-resident WAL/base-backup storage,
  client certificates, and the separate Judge control-plane HA and RabbitMQ
  quorum clusters. Run the documented node-loss and PITR restore exercises.
- **KMS and object storage:** approve and configure an India-resident KMS/key
  controller plus encrypted object storage for source, hidden tests, SEB
  configuration, large outputs, and analytics exports. Supply scoped workload
  identities; do not add plaintext or local fake adapters.
- **Notification provider:** approve a provider, India-resident recipient-data
  path, encrypted address resolver, provider credentials, retention terms, and
  delivery observability before email or SMS is enabled.
- **Judge0 security gate:** prove the pinned upstream image under gVisor with
  non-root/read-only execution, no privilege escalation, no host mounts or
  Docker socket, and deny-by-default/no user-controlled networking. The result
  must be recorded by the compatibility-gate runbook before an engine
  dispatcher or submission-admission adapter is enabled.
- **Production performance and continuity evidence:** execute the 10,000
  candidates/five-minute load profile against the approved engine and real
  question suite; demonstrate submission P95 ≤2 seconds and final-verdict P95
  ≤60 seconds. Exercise PostgreSQL, RabbitMQ, Judge worker, and wrapper-node
  loss with durable queue replay and no lost work.
- **Secrets and security approval:** provision and rotate real authorization
  HMAC material, mTLS issuers, database client certificates, image-signing
  keys, monitoring/alerting destinations, and complete the ASVS, SEB, and Judge
  sandbox security reviews.

## Repository-owned status

All remaining repository-owned backend work continues in this branch. The
current hard boundary is intentional: the implemented completion bridge only
receives and durably reconciles terminal wrapper results; it does not admit new
code to Judge0. The candidate frontend remains out of scope.

See [TASKLIST.md](TASKLIST.md) for the evidence checklist and
[docs/runbooks/judge0-compatibility-gate.md](docs/runbooks/judge0-compatibility-gate.md)
for the Judge release gate.

## Follow-up prompt for the next agent

Continue the backend-only AetherCode foundation work from the current branch.
Do not touch the frontend. Keep the system fail-closed and preserve the current
separation between the platform databases and the Judge0 engine boundary.

Focus on the remaining repository-owned work, especially:

- finish any incomplete backend migrations, adapters, and service wiring
- keep `PENDING.md` current when an item is blocked by an external gate
- preserve the production database topology and security model
- keep the Judge wrapper isolated from the upstream Judge0 schema
- update service READMEs, ADRs, and `TASKLIST.md` as items are completed

Before finishing, verify the backend build, tests, migration checks, and any
service-specific integration coverage that is still relevant to the changes.
