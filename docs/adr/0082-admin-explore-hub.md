# ADR-0082: Admin Explore hub for staff and placement

## Status

Accepted (2026-11-22)

## Context

ADR-0068 keeps `/admin`, `/staff` and `/placement` as separate areas. Platform
administrators already open a college via `/admin/open` for `/staff`, but there
was no single place to pick a college and then drive either the college
workspace or the placement console with the same powers those areas expose.

## Decision

- `/admin/explore` lists every college. Selecting one reveals deep links into
  `/staff/*` and `/placement/*`.
- Links go through `/admin/open?college=&next=`, which sets the working-college
  cookie and now accepts both `/staff…` and `/placement…` targets.
- Staff and placement shells send platform admins “Back to explore” instead of
  a bare admin home.

## Consequences

- Admins replicate college staff and placement officer workflows without
  duplicating those UIs under `/admin`.
- Placement remains globally scoped; the college cookie only records which
  college the admin last opened from Explore.
