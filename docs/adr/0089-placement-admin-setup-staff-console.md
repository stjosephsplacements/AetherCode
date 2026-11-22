# ADR-0089: Placement setup under /admin; /placement is staff-only

- Status: accepted
- Date: 2026-11-22
- Supersedes: the “platform administrators share `/placement`” clause of ADR-0068

## Context

ADR-0068 put placement officers and platform administrators in the same `/placement`
console. That mixed one-time setup (org, tracks, officers) with day-to-day officer
work (students, exams, questions). Officers also saw create-org UI they cannot use,
and the UI never filtered by assigned placement department even though RBAC already
scopes `placement_user` that way.

## Decision

- **`/admin/placement*`** — platform administrators only. Create the single placement
  organisation (ADR-0080), its departments, and assign/remove officers to those
  departments.
- **`/placement`** — `placement_user` only. Officers work in their assigned placement
  department(s): map existing college students into a track, and author questions,
  exams, blogs and related work in scope. Platform admins landing on `/placement`
  redirect to `/admin/placement`.
- **Students:** officers select students already enrolled in a college. They do not
  create accounts. Invariant (ADR-0026): one college department and at most one
  placement department per student.
- Admin Explore links to `/admin/placement` for setup, not into the staff console.

## Consequences

- `requirePlacement` loads placement-department scopes from the viewer’s role
  assignments and no longer admits `super_admin`.
- Setup actions use `requireAdmin` and revalidate `/admin/placement*`.
- Old `/placement/departments` and `/placement/staff` redirect to the admin routes.
- `PUT /user/v1/tenants/{tenant}/students/{student}/placement` assigns or clears
  membership (migration 000056); rejects students already on another track.
- Placement officers see the unplaced pool plus their own track (RLS + authz).
- Officers author shared questions, host-college exams assigned to their tracks,
  and college community blogs under `/placement` (migrations 000056–000057).
