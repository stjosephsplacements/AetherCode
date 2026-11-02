# ADR-0061: Root and delegated super admins

- Status: accepted
- Date: 2026-11-02

## Context

`super_admin` carried one blanket policy (`platform`, `/*`, `*`), and grants only
add access. A platform administrator could not create another one with less
than everything, and nothing protected the first one from being edited or removed.

## Decision

- The **root administrator** is the `super_admin` assignment that granted itself
  (the bootstrap, migration 22). It keeps the blanket policy. Its access cannot be
  edited (`ReplacePermissionGrants` refuses) or revoked (a trigger on
  `users.role_assignments` refuses, whoever calls).
- A **delegated super admin** is a `super_admin` that someone else granted. It has no
  blanket policy: it gets only the resources the editor never lists (its own profile and
  internal tables) from the role, and everything else from platform-scope permission grants.
  The role list endpoint marks the root with `root: true`.
- Only the root changes anyone's permissions. Delegated super admins cannot, even with
  a `permission_grants` grant.
- The console adds a delegated super admin by promoting a staff member, then grants every
  permission in the catalogue so they start with everything. The root narrows them on the
  Permissions page, and can remove them.
- The role view `users.active_role_assignments` carries `granted_by_principal_id`
  (migration 37). `users.is_root_administrator(uuid)` answers the root question.

## Consequences

- A delegated super admin with no grants can sign in but sees almost nothing: safe by default.
- Platform-only permissions (`user.role_assignments`, `tenant.tenants`) can be granted to a
  delegated super admin, but only by the root.
