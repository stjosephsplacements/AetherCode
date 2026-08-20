# Tenant service

The tenant service owns colleges, placement organizations, college and
placement departments, batches, retention policies, legal holds, and tenant
provisioning records in `aether_tenant`.

## Database model

`tenant.departments` explicitly models the two ownership modes:

- A `college` department has a required `tenant_id` and no placement
  organization.
- A `placement` department has a required placement organization and no
  `tenant_id`; it is never nested below a college.

Batch foreign keys and a validation trigger restrict batches to college
departments in the same tenant. Department ownership and tenant IDs are
immutable after creation. Retention defaults implement the agreed seven-year
academic/audit retention, one-year authentication logs, 90-day notification
delivery, and 30-day execution-record baseline; legal holds override purge
workflows.

## RLS and roles

All tenant-owned tables use `FORCE ROW LEVEL SECURITY`. The request role must
call `authz.set_context(...)` inside the same transaction before accessing a
row. Tenant policies require a PID- and transaction-bound signed context whose
exact authorization revision is present in the local projection.

Placement departments are checked through
`authz.current_context_allows_placement(department_id, action, resource)`, so
cross-college access requires the current effective placement-department grant
rather than a broad tenant bypass. Platform-only records use the signed
platform grant check.

Policies use only `tenant.read` and `tenant.write` with fixed resources:
`tenant.tenants`, `tenant.departments`, `tenant.batches`,
`tenant.retention_policies`, `tenant.legal_holds`,
`tenant.placement_organizations`, and `tenant.provisioning_requests`. A write
capability may make the same resource visible for PostgreSQL row targeting, but
every mutation policy still requires its exact `tenant.write` capability.

Database groups are provisioned before migration:

- `aether_tenant_owner`: non-login schema/table owner.
- `aether_tenant_migrator`: migration login and member of owner.
- `aether_tenant_app`: request-serving runtime role.
- `aether_tenant_projection_worker`: the only role allowed to apply local
  authorization-projection events.
- `aether_tenant_authz_reader`: controlled read-only authorization/reconciliation role.

No role may be superuser or `BYPASSRLS`; runtime roles never own tables.

## Implemented workflows

The HTTP API provisions tenants and placement organizations, creates college
and placement departments, creates college batches, updates bounded retention
policies, and places or releases legal holds. Each mutation publishes the
corresponding durable outbox event in the same transaction; the additive
retention and legal-hold v2 events feed Notification without a cross-database
read. All business routes validate Identity, obtain a fresh User authorization
decision over mTLS, and use its signed transaction-local RLS context.

The complete REST contract is in [api/openapi.yaml](api/openapi.yaml).

## Migrations and verification

`000001_bootstrap` establishes role assumptions, private security schemas, and
the signed context contract. `000002_tenant_domain` creates the domain and
reliability tables, triggers, grants, and policies. Run through
`make migrate SVC=tenant DIR=up`; test fresh apply, rollback, no-context denial,
correct-tenant access, wrong-tenant denial, and placement-department access in
the integration suite. Run `go test ./services/tenant/...` for the application
and HTTP workflow tests.

## Soft Delete Behavior

Tenant entities (colleges, departments, batches) support soft delete:

- **Tenant deletion**: Soft-deletes tenant and all child departments/batches
- **Department deletion**: Soft-deletes department and child batches
- **Placement orgs**: SuperAdmin can soft/hard delete placement organizations
- **Retention policies**: Not soft-deletable (configuration data)
- **Legal holds**: Not soft-deletable (must remain immutable until released)

Ref: [ADR-0013](../../docs/adr/0013-soft-delete-architecture.md)

## Authorization projection recovery

`000006_authorization_projection_resync` starts Tenant's local authorization
projection in deny mode. Its dedicated projection worker requests a durable,
UUIDv7-targeted full grant batch via the local outbox and consumes only the
Tenant snapshot/completion subjects. The signed RLS context and `/readyz` stay
closed until every item matches the User-issued count and SHA-256 manifest.
`TENANT_PROJECTION_DATABASE_URL` must authenticate as
`aether_tenant_projection_worker` when `NATS_URL` is configured.
