# ADR-0003: NATS JetStream with transactional outbox and inbox deduplication

- Status: accepted
- Date: 2026-07-24

## Context

At-least-once event delivery must not duplicate scores, permissions, or reports.

## Decision

Persist domain events in each service database transaction, publish them through
an outbox relay, and deduplicate consumers with an inbox table.

## Consequences

Consumers are idempotent and may receive events out of order. No business state
depends on exactly-once broker delivery.
