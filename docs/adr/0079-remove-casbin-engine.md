# ADR-0079: Remove the Casbin engine; role bit sets are the only decision model

- Status: accepted
- Date: 2026-11-16
- Supersedes: the `AUTHZ_ENGINE=casbin|shadow|bitset` cutover plan in ADR-0066 and ADR-0075 (their rollout sections are marked superseded)

## Context

`AUTHZ_ENGINE=bitset` has been live on the campus cluster since 2026-11-08 with no shadow
differences, and migration 000045 dropped `users.authorization_policy_rules`. Since then the
repository no longer loaded policy rows, so the `casbin` engine (still the single-server compose
default) denied every request and `shadow` compared against an empty policy. The Casbin evaluator,
the engine switch and the `casbin/v2` dependency were dead weight in a security path, and a
single-server deployment that kept the default would have been unusable.

## Decision

- The user service decides from role bit sets (`computeAllow`) plus the additive per-person grants of ADR-0055,
  which remain a second authorization input. No other engine decides. `Engine`, `ParseEngine`,
  `WithEngine`, the shadow logging, `Snapshot.PolicyRules` and `SnapshotQuery.RoleBits` are removed;
  snapshots always carry the bit sets and the flag registry.
- `libs/pkg/authz` keeps the role names (`role.go`); `casbin.go` is deleted.
- `AUTHZ_ENGINE` is removed from `docker-compose.yml` and `values-user.yaml`; the service ignores it.
- `github.com/casbin/casbin/v2` and its indirect modules are removed from every Go module.
- Tests that expressed allow rules as Casbin tuples now express them as role bits (`withBits`).

## Consequences

- One decision path to reason about and test. No behavior change on the campus cluster, which
  already ran `bitset`.
- Applied migrations that mention Casbin in comments are left as written.
- A rollback to Casbin is no longer possible without restoring the policy table; the down of
  migration 000045 recreates it empty.
