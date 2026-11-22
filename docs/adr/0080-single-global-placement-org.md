# ADR-0080: One global placement organisation

## Status

Accepted (2026-11-22)

## Context

The tenant API allows many placement organisations, each with departments. In
practice the campus runs one placement cell (e.g. SJPTC) whose tracks (ELITE,
HOPE, PEP, …) every college’s students enrol under. Multi-org UI made officers
create duplicate orgs and pick the wrong parent when adding a department.

## Decision

Product rule: **exactly one placement organisation** for the deployment.

- Departments under that organisation are **global** — any college can assign
  students to them.
- Creating a second organisation is refused in the placement console actions.
- The departments screen manages tracks only; the organisation is a one-time
  setup (create once, edit legal name, no day-to-day org picker).

The HTTP API still lists organisations as a collection so existing clients keep
working. A database unique constraint can follow once legacy duplicates are
cleaned on campus.

## Consequences

- Placement get-started and admin setup copy speak of one org and many tracks.
- `createPlacementDepartment` always attaches to the primary (sole) organisation.
- Extra organisations left from earlier experiments stay readable until deleted
  by a platform admin; new ones cannot be added from the UI.
