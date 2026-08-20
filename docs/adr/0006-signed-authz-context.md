# ADR-0006: Signed authorization context for local RLS

- Status: accepted
- Date: 2026-07-24

## Context

Application-set PostgreSQL custom GUC values alone can be forged by an unsafe
query path and cannot establish immediate revocation across service databases.

## Decision

The User service issues five-second, audience-bound HMAC-signed decisions. Each
service validates the signature and exact local authorization revision through
security-definer SQL before setting transaction-local RLS context.

## Consequences

Direct GUC manipulation cannot bypass RLS. A decision or projection outage
denies new protected work instead of serving stale permissions.
