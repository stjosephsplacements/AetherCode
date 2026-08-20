# ADR-0007: India-only residency and tenant-configurable retention

- Status: accepted
- Date: 2026-07-24

## Context

College exam records contain student data, source code, and protected test data.

## Decision

Store primary data, backups, object storage, and PII telemetry in India. Tenant
retention policies and legal holds govern purge workers, with conservative
academic/audit, authentication, notification, Judge wrapper, and engine-payload
defaults.

## Consequences

Retention is an enforced data lifecycle rather than an operational convention;
all purge workers must check legal holds before deletion.
