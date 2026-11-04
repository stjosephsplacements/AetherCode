# ADR-0065: Admin console on its own route

- Status: accepted
- Date: 2026-11-03

## Context

Platform pages (colleges, platform analytics, platform administrators) lived inside `/staff`, mixed
with one college's workspace and gated page by page on `isPlatformAdmin`.

## Decision

`/admin` is a separate area with its own layout, sidebar and a guard in `requireAdmin`
(`super_admin` only; everyone else is sent to `/staff`). It holds Colleges, Administrators,
Analytics, System status and Audit log. Super administrators now land on `/admin` after sign-in.
`/staff` stays one college's workspace; `/staff/colleges` and `/staff/analytics/platform` redirect.
System status and Audit log keep their `/staff` routes for college administrators (own college only)
and are served again at `/admin/*` with the cross-college view.

## Consequences

- Navigation and routes change only; every API still authorises server-side.
- `/staff` now redirects a super administrator to `/admin` unless they opened one college on purpose
  (an "Open workspace" link on the admin overview, via `/admin/open`). Each sign-in clears that choice.
  The further admin features (emergency controls, version-skew view, access reviews), are follow-ups.

## Incident board

`/admin/incidents` lists what needs attention across every college: services not ready, pods
below their desired replicas or restarting (from Prometheus), judge queue waits and failures, and
exams open now. Per open exam an administrator can add time to everyone in progress or announce to
everyone, using the same submission endpoints as the college monitor. Freezing an exam or pausing
the judge queue needs new backend endpoints and is not part of this.
