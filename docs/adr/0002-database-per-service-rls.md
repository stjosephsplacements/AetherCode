# ADR-0002: Database per service with local row-level security

- Status: accepted
- Date: 2026-07-24

## Context

Colleges require strong tenant isolation while each service must own its data.

## Decision

Each platform service receives a separate logical PostgreSQL database, role
set, migrations, backup scope, and local authorization projection. Tenant-owned
tables use forced RLS; services do not use cross-database foreign keys.

## Consequences

Cross-service references are opaque IDs validated through contracts and events.
Projection lag is fail-closed instead of granting stale access.
