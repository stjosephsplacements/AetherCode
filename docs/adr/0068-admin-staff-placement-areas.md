# ADR-0068: Admin, staff and placement are separate areas

- Status: accepted (frontend part implemented)
- Date: 2026-11-03

## Context

ADR-0065 added `/admin`, but `/staff` still carried cross-college behaviour: college filters, an
all-colleges mode, a college switcher and a pooled placements page. Placement officers, who span colleges,
had no area of their own.

## Decision

- `/admin`: platform administrators. Every college, platform health, administrators, audit.
- `/staff`: one college. A member works in their own college; a platform administrator opens one from
  `/admin/open?college=` (sets the working college) and returns with "Back to admin". There is no all-colleges
  mode, college filter or switcher inside `/staff`.
- `/placement`: placement staff, who hold no college role, and platform administrators. Students of the
  placement departments they belong to, across colleges. Placement-only accounts never see `/staff`.
- `/student`: unchanged, one college.
- `homeFor` returns the area; entering the wrong area redirects to the viewer's own. Role names, labels and
  tiers live in `frontend/src/lib/rbac.ts`.

## Consequences

- Cross-college reads leave `/staff`. `/placement` reads through the placement context once the backend
  read model (ADR-0066) ships; until then a placement officer sees the college their account belongs to.
- The permissions editor for platform scope is still reached through a college workspace; it moves into
  `/admin/roles` with the roles UI.
