# ADR-0075: Wire rbac.Compute into the authorize path

- Status: accepted
- Date: 2026-11-08
- Supersedes: the overwrite resolution part of ADR-0066

## Context

ADR-0066 introduced Discord-style roles with `bit(256)` permission sets and an overwrite
resolution algorithm (`rbac.Compute`). The cutover strategy runs both Casbin and the
bitset engine in shadow mode.

The shadow path (`bitsAllow`) evaluates each assignment's role bits independently. It
checks `ADMINISTRATOR`, `VIEW_SCOPE` and the resource flag, but it does not apply
overwrites. As a result:

- `users.permission_overwrites` rows are stored and managed via `PUT /role-overwrites`
  but never evaluated during authorization.
- The full Discord walk in `rbac.Compute` (base from roles on path, `@everyone`
  overwrite, role overwrites, member overwrite, implicit rules) has zero production
  callers.
- Flipping `AUTHZ_ENGINE=bitset` without wiring `Compute` would silently ignore all
  overwrites.

## Decision

Wire `rbac.Compute` into the bitset path of `Service.Authorize`:

1. The authorization snapshot loads `@everyone` role perms and `permission_overwrites`
   for the request's tenant when role bits are active.
2. Instead of calling `bitsAllow` per assignment, the bitset path builds an
   `rbac.Member` from the caller's assignments, constructs the scope path from the
   assignment's node, and calls `rbac.Compute` once for each scope tree (college and
   placement). `rbac.Combine` ORs the results.
3. The resolved `Perms` are then checked for the requested permission flag, matching
   what `bitsAllow` checked: `ADMINISTRATOR`, `VIEW_SCOPE`, and the `service.resource.action`
   flag with write-implies-read expansion.
4. Shadow mode logs every difference between the Casbin result and the `Compute` result,
   per assignment, just as it logged `bitsAllow` differences.
5. `bitsAllow` stays as a package-internal function tested in isolation; the authorize
   path calls the new `computeAllow` which wraps `rbac.Compute`.

The Casbin code path, the `assignmentApplies` filter, the grant fallback and every
other part of the authorize loop are unchanged.

## Consequences

- Overwrites are now live in shadow and bitset modes. The shadow log will surface any
  divergence between Casbin (which has no overwrites) and the resolved bits before the
  cutover.
- A correct `AUTHZ_ENGINE=bitset` cutover becomes possible once the shadow log is quiet.
- The `PUT /role-overwrites` endpoint validation (reject no-op rules) and the Casbin
  removal remain separate future steps.
