# Identity service

The identity service owns global authentication state in `aether_identity`:
principals, Argon2id password hashes, encrypted TOTP factors, rotating refresh
token families, reset tokens, lockouts, and append-only authentication events.
It never stores a plaintext password, reset token, recovery code, MFA secret,
or SEB material.

## Database migrations

Run migrations only with the `aether_identity_migrator` login. It must be a
member of the non-login `aether_identity_owner` role, which owns all schemas
and is never a runtime credential. Runtime connections use
`aether_identity_app`; event consumers that update the authorization
projection use only `aether_identity_projection_worker`.

`000001_bootstrap` creates the private `authz` and `app` schemas, the service
schema, `pgcrypto` in `extensions`, signed-request context functions, and the
event-fed local authorization projection. `000002_identity_domain` creates the
identity records and inbox/outbox/idempotency tables. Authentication events are
monthly partitioned; the service maintenance job must call
`identity.ensure_auth_event_partition()` ahead of the next month and alert on
rows landing in the default partition.

The identity tables are global rather than tenant-owned. Tenant enforcement is
therefore applied to downstream service data, while identity table access is
limited to this service's mTLS runtime role and service API.

## Implemented authentication workflows

The HTTP API implements registration and email activation, password login,
MFA challenges, refresh-family rotation and replay detection, logout,
password reset, and authenticated TOTP enrollment/activation/disable. Every
access token is also checked against durable session state, so logout, reset,
and MFA changes invalidate it before its short JWS lifetime ends.

Sensitive bearers are never persisted in plaintext. Registration and reset
delivery values are returned only to the immediate trusted delivery path; the
HTTP response includes them solely when the explicitly development-only secret
exposure setting is enabled. TOTP seeds and recovery codes are similarly
one-time, no-store responses. The full public contract is in
[api/openapi.yaml](api/openapi.yaml).

## Signed request context

Protected requests must be inside one explicit database transaction and call:

```sql
SELECT authz.set_context(
  actor_id, tenant_id, authz_revision, 'allow', action, resource,
  issued_at, expires_at, key_id, hmac_sha256
);
```

The function accepts only a five-second HMAC-SHA-256 capability for this
database's audience. It validates an exact local authorization-projection
revision, creates a random unlogged context bound to the PostgreSQL backend PID
and transaction ID, and sets only `app.authz_context_id` transaction-locally.
Directly setting GUCs cannot create usable access. The `authz.context_keys`
table is provisioned from KMS deployment material and is unreadable to runtime
roles.

`aether_identity_projection_worker` alone can call
`authz.apply_tenant_authorization(...)`; normal application connections have
no direct DML privilege on any `authz` table.

## Verification

Apply the paired migrations through `make migrate SVC=identity DIR=up` after
the platform database role bootstrap. Migration validation covers fresh apply
and rollback on PostgreSQL 18. Run `go test ./services/identity/...` for
authentication, token rotation, MFA, lockout, and HTTP boundary coverage.

## Soft Delete Behavior

Principals and credentials support soft delete for account deactivation:

- **Soft delete**: Archives authentication records while preserving audit history
- **Hard delete**: SuperAdmin can permanently remove principals after retention period
- **Refresh tokens**: Already use `revoked_at` (similar to soft delete)
- **MFA enrollments**: Soft-deleted when principal archived

Ref: [ADR-0013](../../docs/adr/0013-soft-delete-architecture.md)

## Rate limiting

`POST /v1/auth/register`, `POST /v1/auth/login`, `POST /v1/auth/password-reset`,
and `POST /v1/auth/password-reset/complete` are each protected by an
in-process, per-client-IP token bucket (`libs/pkg/ratelimit`). Password reset
request and completion share one budget, since both are the same abuse
surface. A rate-limited request receives `429 Too Many Requests` with a
`Retry-After: 3600` header.

| Endpoint(s) | Burst env var | Refill-per-hour env var | Defaults |
|---|---|---|---|
| `POST /v1/auth/register` | `IDENTITY_REGISTER_BURST` | `IDENTITY_REGISTER_RATE` | burst 2, 5/hour |
| `POST /v1/auth/login` | `IDENTITY_LOGIN_BURST` | `IDENTITY_LOGIN_RATE` | burst 10, 30/hour |
| `POST /v1/auth/password-reset`, `POST /v1/auth/password-reset/complete` | `IDENTITY_PASSWORD_RESET_BURST` | `IDENTITY_PASSWORD_RESET_RATE` | burst 3, 5/hour |

## Authorization projection recovery

`000006_authorization_projection_resync` replaces Identity's legacy
single-grant projection with complete `authz.grants_snapshot.v1` grant
snapshots. On every start or projection-consumer failure, the dedicated
`aether_identity_projection_worker` writes a UUIDv7 recovery request through
the local outbox and consumes only Identity's targeted response subjects.
`/readyz` remains unavailable, and both tenant and global RLS contexts deny,
until the exact count/SHA-256 manifest completes. In environments with NATS,
`IDENTITY_PROJECTION_DATABASE_URL` must use that worker role, never an app or
owner credential.
