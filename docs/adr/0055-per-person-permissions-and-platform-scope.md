# ADR-0055: Per-person permissions, and one platform-wide view for the root admin

- Status: proposed (needs review: it changes authorization)
- Date: 2026-11-01

## Context

Access today comes from six fixed roles (`super_admin`, `placement_user`,
`college_admin`, `department_user`, `mentor`, `student`) and Casbin rules of the form
`role, scope, object, action`. Role assignments are limited by a CHECK to those names and
scopes. There is no way to give one person a little more or less than their role, and a
root administrator has to pick a college in a switcher before seeing anything, because
every business route is per college (`/tenants/{id}/...`).

finalized-codepro works differently: its super admin sees every college's tests at once,
college staff are limited to their own college plus the colleges mapped to them, and
placement staff are limited to their placement. Admins want the same, plus a screen to
grant exactly the permissions a person needs.

## Decision

**1. A catalogue of permissions.** Every thing that can be done is one `resource.verb`
entry, grouped for the editor (Questions, Exams, Students, People, Organisation,
Results, Platform). Verbs are `read`, `write` and `delete`. The catalogue is generated
from the same resource tables the authorizer already uses, so it cannot drift.

**2. Per-person grants.** A new table `users.permission_grants`:
`(id, principal_id, scope_kind, scope_id, permission, granted_by, created_at)`, scoped to
a college, a department, a batch, or the platform. A grant adds to what the person's role
already allows; it never removes anything.

**3. Write includes read.** Granting `write` or `delete` grants `read` on the same
resource. The editor does this when the permission is dropped into the box, and the
authorizer expands it again when it evaluates, so a hand-edited row cannot create write
without read.

**4. A ceiling on who can grant.** A person can grant only what they hold themselves,
and only inside their own scope. A college admin grants within their college (and the
colleges mapped to them); only a root administrator grants platform scope. Every grant
and revoke is written to the staff audit log (ADR-0043).

**5. The root administrator has everything.** `super_admin` already holds
`platform /* *`. That stands: read, write and delete on every resource, in every college.

**6. A platform-wide view, without row-level-security changes.** For a root administrator
the console stops asking for a college. List pages (exams, batches, students, analytics,
calendar, dashboard) fetch each college's data through the same per-college routes the
admin is already allowed to call, and merge it with a college column and a college
filter. Creating something asks which college it is for. Nothing changes in the database
policies. The cost is one request per college, so lists are capped and paged by college.

**7. Placement tests follow the placement officer's own grants.** What a placement
officer can test, and which colleges' students they can assign to, is decided by the
grants they hold, not by a fixed rule.

## Out of scope for the first cut

- One exam row shared by several colleges. Assigning one exam to students in several
  colleges stays "create per college, from the same source exam" until the assessment
  service gets a platform-level exam.
- Time-limited grants.

## Consequences

- New migration in the user service, a change to `Authorize`, and tests that prove a grant
  adds access, never removes it, cannot exceed the granter, and expands write to read.
- Role-assignment CHECK constraints are untouched.
- This touches authentication and authorization, so it ships only after review.
