# ADR-0005: Three-node India-hosted PostgreSQL HA topology

- Status: accepted
- Date: 2026-07-24

## Context

The first production target supports at least 10,000 active candidates and must
survive a single node failure.

## Decision

Deploy logical service databases on a three-node PostgreSQL HA cluster with one
primary, two replicas, synchronous one-replica commit, automatic failover,
encrypted WAL archives, and India-only backup storage.

## Consequences

Three independently failing physical hosts are a production prerequisite. A
single server remains suitable only for development or non-HA validation.
