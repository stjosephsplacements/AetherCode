# User service

The user service is the canonical source for profiles, student records,
medallion role assignments, mentor-to-batch links, placement-staff membership,
student department history, and authorization revisions in `aether_users`.

## Two-department invariant

Every active student has exactly one active college and one active placement
membership. The append-only-style `student_department_memberships` history is
paired with `current_student_affiliations`, whose trigger verifies that both
referenced memberships belong to the same student and tenant and have the
required types. Partial unique indexes prevent more than one active membership
of either type; active-student and current-affiliation triggers prevent an
incomplete affiliation state.

Department, batch, tenant, and identity IDs are opaque UUID references. This
service deliberately has no cross-database foreign keys.

## Canonical authorization data

`users.role_assignments` is the source for the Golden/Silver/Bronze scope
model. It stores role, scope kind, optional tenant, scope UUID, lifecycle, and
granting principal. `users.placement_department_memberships` supplies the
explicit relationship required for placement access. Casbin policy rows live in
`users.authorization_policy_rules`, while `users.authz_revisions` is the
monotonically increasing revision returned by `authz/v1.Authorize`.

The private `authz/v1.Authorize` gRPC implementation:

1. Reads the subject's current revision and active role assignments through the
   dedicated `aether_user_authz_reader` credential.
2. Evaluates active Casbin rules plus tenant/department/batch scope and
   placement department membership; access to a cross-college student must be
   derived from that student's current placement membership.
3. Returns allow/deny, the resolved tenant/resource scope, and the exact
   `authz_revision` used for the decision.
4. Relies on every role or placement relationship change to emit the
   `authz.revision_changed.v1` outbox event and publish a full effective grant
   snapshot for that revision to each service projection.

Database triggers increment the revision and enqueue this event synchronously
for role assignments, placement staff changes, and student placement-membership
changes. A stale target projection therefore cannot match a newly signed
decision and denies access.

## Projection bootstrap and retention recovery

Normal grant events are retained in JetStream for eight days, so a durable
consumer cannot safely recover by replay alone after a longer outage. User is
the sole authority for the targeted, outbox-backed resync protocol documented
in [`libs/pkg/authzprojection`](../../libs/pkg/authzprojection/README.md).
It accepts only the fixed platform service target enum, validates the exact
versioned subject and strict request payload, deduplicates request/resync IDs,
and admits at most one batch per target every 30 seconds.

For each accepted request User emits a complete current grant snapshot for
every principal revision plus a SHA-256 count/manifest completion event. A
target service's local database remains RLS-deny-by-default until it has
applied the entire matching manifest. User follows the same rule for its own
local projection at startup and on messaging-consumer recovery.

When messaging is enabled, `USER_PROJECTION_DATABASE_URL` must use the
dedicated `aether_user_projection_worker` credential. `NATS_URL` is required
outside development; no request-serving credential receives direct access to
resync state or canonical authorization tables.

`000014_authorization_resync_identity_target` expands the fixed target enum to
include Identity after Identity gained a complete local grant projection. The
allow-list remains database-enforced; adding a consumer alone cannot cause User
to issue a batch to an unapproved service.

## Authorization ingress

`authz/v1.Authorize` is private. In staging and production it accepts only a
TLS 1.3 client certificate chain verified by the configured client CA and an
exact configured SPIFFE URI SAN. `AUTHZ_MTLS_SERVICE_TARGETS` is a JSON object
that binds each workload SPIFFE ID to the only service database it may target;
for example,
`{"spiffe://aethercode.local/ns/platform/sa/submission":"submission"}`.
Common Names are ignored. An absent or unmapped URI SAN, multiple mapped
identities, or a request for another target service is denied before policy
evaluation.

Each protected call also includes `identity_assertion`. Authz verifies it with
the shared strict Ed25519 verifier and rejects assertions that do not bind the
same principal and request ID. Production configuration requires
`AUTHZ_IDENTITY_ASSERTION_ISSUER`, `AUTHZ_IDENTITY_ASSERTION_AUDIENCE`, and
`AUTHZ_IDENTITY_ASSERTION_PUBLIC_KEYS` (a JSON `key_id` to base64 public-key
map). Identity signing keys never leave the Identity service. These checks are
fail-closed; no positive authorization cache survives a request boundary.

## RLS and signed context

Request-serving tables are `FORCE RLS`. A protected transaction calls
`authz.set_context(actor, tenant, revision, 'allow', capability_id, action,
resource, issued_at, expires_at, key_id, signature)` before reading or writing.
The HMAC capability is valid for at most five seconds, database-audience-bound,
bound to its Authz decision ID, and consumed once into a random context row
bound to the backend PID and transaction ID.
Only `aether_user_projection_worker` can apply the local authorization
projection; the app role has no direct DML on `authz` data.

Student RLS adds a placement-specific relationship check: a projected
`placement` grant is valid only for a student with an active placement
membership whose department matches the grant source. Tenant and platform
grants retain their normal tenant-wide behavior.

Policies use only `user.read` and `user.write` with fixed resources:
`users.profiles`, `users.students`, `users.student_department_memberships`,
`users.current_student_affiliations`, `users.mentor_batch_assignments`,
`users.role_assignments`, and `users.placement_department_memberships`. A
write capability supplies the same-resource visibility PostgreSQL needs to
target an update or delete; the mutation policy itself still requires the exact
`user.write` capability.

Required groups are `aether_user_owner`, `aether_user_migrator`,
`aether_user_app`, `aether_user_authz_reader`, and
`aether_user_projection_worker`. The reader is a separate, read-only
authorization-process credential, not a request API credential.

## Soft Delete Behavior

All user entities support soft delete (archival without physical removal):

- **Default queries**: Filter `deleted_at IS NULL` automatically
- **Soft delete**: `DELETE /students/:id` with `{"reason": "..."}` (all authorized roles)
- **Hard delete**: `DELETE /students/:id/hard` with `{"reason": "..."}` (SuperAdmin only)
- **Cascade**: Soft deleting a student cascades to department affiliations
- **Audit trail**: `deleted_by` and `deletion_reason` columns track who deleted and why

### Authorization Rules

| Role | Soft Delete | Hard Delete | View Archived |
|------|-------------|-------------|---------------|
| SuperAdmin | ✓ | ✓ | ✓ |
| CollegeAdmin | ✓ (own tenant) | ✗ | ✓ (own tenant) |
| DepartmentUser | ✓ (own dept) | ✗ | ✓ (own dept) |
| Mentor | ✗ | ✗ | ✗ |
| Student | ✗ | ✗ | ✗ |

Ref: [ADR-0013](../../docs/adr/0013-soft-delete-architecture.md)

## Migrations and verification

`000001_bootstrap` installs the shared security contract. `000002_user_domain`
creates the user model, reliability tables, invariant triggers, authorization
data, outbox revision events, and RLS policies. `000003_authorization_policy_bootstrap`
seeds the canonical policy baseline and advances assigned principals' revisions
when policy rows change. Run with
`make migrate SVC=user DIR=up`; integration coverage must include both
affiliations, placement revocation, revision lag denial, and duplicate-event
idempotency, plus the full-manifest bootstrap/resync path.
