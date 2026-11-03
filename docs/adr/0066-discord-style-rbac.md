# ADR-0066: Discord-style roles with Gold, Silver and Bronze tiers

- Status: accepted (implementation in progress; supersedes 0055 and 0061 once the contract migration ships)
- Date: 2026-11-03

## Context

Roles are a closed enum of six names fixed in Go constants, SQL CHECK constraints and `validRoleScope`.
Policies are Casbin rows ("some allow", no deny, no hierarchy). A department or batch role is compared
by tenant only, so a department user reaches the whole college. The grant ceiling promised by ADR-0055
is not enforced. Placement staff are bespoke special cases.

## Decision

- **Roles are rows, not columns.** `users.roles` holds a name, a tier, a position and a `bit(256)`
  permission set. Managed roles (owner, `student`, `@everyone`) are immutable.
- **Tiers** follow docs/PLAN.md section 4: Gold (platform: owner, super_admin, placement_officer), Silver
  (one college: college_admin, department_user, custom college roles), Bronze (batch or self: mentor,
  student). Rank is `(tier, position)`.
- **Permissions are bit flags** from an append-only registry (`users.permission_flags`): meta flags such as
  `ADMINISTRATOR`, `MANAGE_ROLES`, `VIEW_STUDENT_PII`, plus one `service.resource.read|write` flag per
  route. Write implies read.
- **Resolution follows Discord's algorithm** walked down the scope path (platform, college, department,
  batch; placement organisation, placement department): base is `@everyone` plus the roles assigned on the
  path; owner or `ADMINISTRATOR` return everything; then per node `@everyone` overwrite, role overwrites
  (all denies, then all allows), member overwrite. A missing `VIEW_SCOPE` yields nothing.
- **Hierarchy and ceiling** are enforced in the service and by database triggers: an actor manages only roles
  and members strictly below their highest rank, inside their scope subtree, and grants only bits they hold.
- **Elevated flags** (`ADMINISTRATOR`, `MANAGE_ROLES`, `MANAGE_OVERWRITES`, `EXPORT_DATA`,
  `VIEW_STUDENT_PII`) need MFA verified in the last 15 minutes (`mfa_verified_at` in the identity assertion).
- **Students** keep exactly one college. Their `student` assignment is managed and tied to
  `users.students.tenant_id`. A placement department still groups students of many colleges.
- **Cutover** is expand, backfill, contract behind `AUTHZ_ENGINE=casbin|shadow|bitset`; shadow mode runs both
  engines and logs differences before the switch.

## Consequences

- Colleges can create their own roles under their own ceiling. Delegation is safe by construction.
- The authorization decision stays central; the capability and the authz projection are unchanged except
  for a bounded `nodes` claim for department and batch scoping.
- Legacy platform-wide `placement_user` access ends: a placement officer needs a placement-department
  membership.
