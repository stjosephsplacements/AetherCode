# AetherCode documentation

This documentation records both the delivered foundation and the evidence
required before it may be promoted. Architecture and migration assets are not
proof of a live HA deployment, safe Judge0 execution, or the required load
profile. The current boundary is maintained in [TASKLIST.md](../TASKLIST.md).

## Start here

- [Architecture and implementation plan](../PLAN.md) — service ownership,
  topology, retention, and promotion requirements.
- [Database architecture](database/README.md) — logical databases, roles, and
  service ownership.
- [Signed authorization context](database/authorization-context.md) — the User
  `Authorize` decision, capability envelope, local revision projection, and
  RLS transaction contract.
- [Migration verification](database/migration-verification.md) — disposable
  PostgreSQL 18 fresh-up/down/up verification through dedicated migrator roles.
- [Version verification](architecture/version-verification.md) — the source of
  the initial dependency/image pins and the Context7 fallback record.
- [Architecture decision records](adr/) — accepted topology, security,
  residency, and Judge-boundary decisions.
- [Gateway and SEB enforcement boundary](adr/0012-gateway-seb-enforcement-boundary.md)
  — fixed public routing, assertion verification, and candidate-bound SEB
  validation.

## Operational documentation

- [Platform PostgreSQL HA runbook](../deploy/runbooks/platform-postgres-ha.md)
  — the required three-node, synchronous-replication, node-failure, and PITR
  checks.
- [Judge control-plane operations](runbooks/judge-control-operations.md) —
  private mTLS operation and durable completion handling.
- [Judge0 gVisor compatibility gate](runbooks/judge0-compatibility-gate.md) —
  the blocking evidence needed before enabling the engine.

## Soft Delete Architecture

Platform-wide soft delete ensures data safety and compliance:

- **ADR-0013**: [Soft delete architecture decision record](adr/0013-soft-delete-architecture.md)
- **Template**: `docs/templates/soft-delete-migration.sql` for adding to services
- **Shared utilities**: `libs/pkg/database/softdelete.go` provides GORM scopes
- **Authorization**: Only SuperAdmin can hard delete via security-definer function

All services implement soft delete for tenant-scoped entities.

## Current implementation boundary

The repository contains paired service migrations, a local role/database
bootstrap, a production HA chart that is render-gated on certificates and
India-resident backup configuration, and implemented backend APIs for identity,
tenant/user, question-bank, assessment, submission, SEB, notification, and
analytics workflows. Gateway is a fixed-upstream edge with per-request identity
verification and configurable fail-closed SEB enforcement. Authorization grant
projections have durable, manifest-verified resync recovery and deny access
while they are unavailable.

The repository does not claim a live HA deployment, a real KMS/object-store
integration, an external notification provider, encrypted analytics export
storage, a platform-side Judge **admission** adapter, or a safe Judge0 engine
dispatcher. Submission does contain a receive-only completion bridge: it pulls
leased wrapper results over mTLS, persists them idempotently with a dedicated
database role, publishes `judge.completed.v1`, and ACKs only after commit.
Those boundaries are external integration or release-gate work, not
placeholders that may be bypassed locally. The candidate frontend is also
intentionally untouched.

Judge wrapper persistence is isolated from the upstream engine: it uses a
separate PostgreSQL HA control plane and RabbitMQ quorum cluster. Judge0's
upstream PostgreSQL and Redis are engine-internal, opaque to the wrapper, and
remain disabled until the compatibility gate is approved.
