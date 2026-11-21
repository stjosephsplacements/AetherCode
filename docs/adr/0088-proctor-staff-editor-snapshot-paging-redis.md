# ADR-0088: Staff proctor policy editor, snapshot keyset paging, Redis cooldown

- Status: accepted
- Date: 2026-11-21

## Context

ADR-0080 defined violation policy, evidence export and auto-submit, but staff
could not author policies in the UI, evidence and the attempt gallery stopped at
the first 200 snapshots, and the proctor cooldown lock was process-local so
replicas could double-count a kind. Role-targeted RBAC overwrites also failed
to match because `computeAllow` compared role names to UUID targets.

## Decision

**Staff policy editor** at `/staff/proctor-policies`: create a policy, draft and
publish versions, and attach a published version when creating an exam. Form
fields map to the ADR-0080 body (`enabled`, cooldown, max, auto-submit, counted
kinds). Shared `ViolationKind` labels live in the frontend.

**Snapshot keyset paging**: submission migration `000050` extends
`list_snapshots` with optional `p_before_id`. The HTTP query `before` and
evidence export walk pages until a short page. The attempt UI loads earlier
frames with the same cursor. Page size stays capped at 200.

**Redis shared cooldown**: set `PROCTOR_REDIS_URL` so
`SET proctor:cooldown:{attempt}:{kind} NX EX` serialises replicas. Empty URL
keeps the database fallback (replicas can race). Single-server Compose runs a
`redis` service; Helm `values-proctor` points at
`redis://redis:6379/0` and allows egress to a Service labelled
`app.kubernetes.io/name: redis` in the same namespace (that Service must exist
before enabling Redis cooldown in cluster).

**RBAC RoleID**: the authorization snapshot SQL selects `r.id` into
`Assignment.RoleID`; `computeAllow` passes that UUID into the bitset engine so
role-targeted overwrites match.

**CI**: `make proctor-test` runs policy/cooldown/config unit tests with
`--no-project` (no torch/mediapipe), and a CI job calls that target.

## Consequences

- Apply submission `000050` before relying on `before=` or full evidence export.
- Cluster deploys need a Redis Service named/labelled as above, or leave
  `PROCTOR_REDIS_URL` empty and accept replica races.
- Assignments projected before ADR-0080 still carry a NULL policy until
  Assessment re-emits (owner-approved); that is unchanged.
- Live GPU + NATS proof on campus remains an operational gate, not a code gate.
