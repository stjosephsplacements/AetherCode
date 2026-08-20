# ADR-0004: Central typed Casbin authorization decisions

- Status: accepted
- Date: 2026-07-24

## Context

Medallion roles and cross-college placement membership require current,
relationship-aware decisions.

## Decision

The User service owns typed role bindings, canonical Casbin policy rows, and
access revisions. It evaluates the current policy and relationship scope for
every protected request, then issues a fresh signed decision.

## Consequences

Services fail closed when the decision service or local projection is stale.
Typed binding invariants remain in SQL; policy-row changes synchronously advance
the revisions of principals assigned to the affected role.

An eight-day JetStream retention window is not a recovery source of truth.
Each RLS-protected database therefore starts and recovers with its local
projection gate closed, writes a target-specific durable resync request, and
reopens only after User has emitted a complete current grant batch whose count
and SHA-256 manifest match locally applied snapshots. User rate-limits and
deduplicates these requests; ordinary `authz.grants_snapshot.v1` propagation
remains unchanged.

Identity is included in this target set because its signed tenant and global
RLS contexts are protected service paths. It uses the same complete snapshot
and manifest gate as the tenant-scoped services rather than relying on its
legacy single-grant projection.
