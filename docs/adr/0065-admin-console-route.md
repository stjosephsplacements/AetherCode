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
- Super administrators keep the college switcher inside `/staff` for now. Removing it, and the
  further admin features (emergency controls, version-skew view, access reviews), are follow-ups.
