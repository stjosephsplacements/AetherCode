# Notification

Notification owns tenant-scoped preferences, encrypted notification content
references, durable in-app delivery records, provider idempotency metadata,
and 90-day delivery retention. It never stores notification plaintext,
recipient contact secrets, or decrypted provider payloads.

## Implemented workflow

- A caller can create or optimistically update only its own `in_app`
  preference. The central User policy uses the bearer subject as the resource
  ID, and the database procedure independently binds it to the signed RLS
  context actor.
- An authorized staff workflow can schedule a notification with an encrypted
  object key, checksum, and KMS/key-controller reference. A durable outbox
  emits `notification.scheduled.v1` without content references.
- A bounded in-process runner invokes the owner-owned
  `notification.deliver_due_in_app` procedure every second. It appends a
  `delivered` or `suppressed` attempt and finalizes the notification
  transactionally; a crash leaves pending rows eligible for another replica.
- Cancellation is optimistic and idempotent. All mutations require an
  `Idempotency-Key`; successful JSON responses are replayable for 24 hours.

Email is deliberately not exposed as a preference yet: a production email
channel requires an encrypted-address resolver and a decrypting provider
adapter. The database schema reserves the channel but does not claim delivery
that has not occurred.

## Soft delete and hard delete

Notification supports soft delete for user-facing tables:

- **recipient_preferences**: User preference records can be soft deleted
- **notifications**: Notification records can be soft deleted  
- **provider_idempotency_records**: Provider idempotency metadata can be soft deleted
- **delivery_attempts**: Append-only audit trail, NO soft delete (protected by trigger)

Soft-deleted records are automatically excluded from normal queries via RLS policies. The owner role can still access them for maintenance and audit purposes.

Hard delete requires super_admin role and is logged in `app.hard_delete_audit_log`. Use `app.hard_delete(table_name, record_id, actor_id, reason)` for permanent deletion. Migration: `000010_soft_delete_schema`.

## Authorization, retention, and events

Every business request validates identity through the User authorization
service, obtains a fresh mTLS decision, and starts one signed local RLS
transaction. `000004_authorization_grant_snapshots` makes missing or lagging
local grant snapshots deny access.

The service consumes additive Tenant events:

- `tenant.retention_policy.updated.v2` updates the delivery-retention default
  for newly scheduled notifications.
- `tenant.legal_hold.placed.v2` and `tenant.legal_hold.released.v2` update a
  local legal-hold projection and re-evaluate both notifications and append-
  only delivery attempts. Tenant, student, Assessment, and Submission scopes
  are supported through opaque IDs.

The existing `v1` Tenant events remain published for compatibility. Retention
purge procedures never remove held data. `000008` serializes each legal-hold
transition and each candidate deletion through a tenant state row, then the
dedicated retention identity calls one bounded owner-owned purge function. The
worker rechecks the hold after taking its shared tenant lock, so an in-flight
hold cannot race a deletion. The full HTTP contract is in
[api/openapi.yaml](api/openapi.yaml).

## Runtime configuration and verification

`NOTIFICATION_DATABASE_URL` must use the non-owner application role.
`NOTIFICATION_PROJECTION_DATABASE_URL` must use the dedicated projection role
whenever `NATS_URL` is configured. Standard `AUTHZ_*` variables configure the
fresh User-service mTLS decision client.

`NOTIFICATION_RETENTION_ENABLED=true` is required in staging and production.
`NOTIFICATION_RETENTION_DATABASE_URL` must use
`aether_notification_retention_worker`, which has no direct table privileges
and can execute only the bounded retention procedure. Tune
`NOTIFICATION_RETENTION_BATCH_SIZE` (1–10,000),
`NOTIFICATION_RETENTION_MAX_BATCHES` (1–100), and
`NOTIFICATION_RETENTION_POLL_INTERVAL` (10 seconds–1 hour) only through the
approved deployment configuration. Readiness fails if the dedicated worker
cannot complete a recent purge cycle.

Run from the repository root:

```sh
go test ./services/notification/...
make test-migrations
```

## Authorization projection recovery

`000007_authorization_projection_resync` makes Notification RLS and `/readyz`
deny/not-ready until a targeted full authorization batch has the exact User
count/SHA-256 manifest. `aether_notification_projection_worker` makes the
UUIDv7 request through the local outbox and has no broad domain-table grant;
`NOTIFICATION_PROJECTION_DATABASE_URL` must use this role when NATS is enabled.

`000008_retention_execution_boundary` adds the dedicated retention-worker
database role boundary and the tenant-state lock that orders legal-hold and
purge work safely. It refuses rollback while an active hold exists.
