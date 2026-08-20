# Tenant migrations

Run paired `golang-migrate` files with the `aether_tenant_migrator` credential:

```sh
make migrate SVC=tenant DIR=up
```

It must be a member of the non-login `aether_tenant_owner` role. `000001`
creates the role-bound security schemas, signed context functions, and private
authorization projection. `000002` creates tenant, department, batch,
retention, and legal-hold data with forced RLS. `000003` adds the
platform-scoped provisioning and placement authorization policies required by
the HTTP workflows.

Apply the database/KMS role bootstrap first. Roll back domain migration
`000003`, then `000002`, before bootstrap migration `000001`; never alter a migration that has
reached an environment. Use expand/backfill/contract migrations for destructive
changes.

`000006_authorization_projection_resync` adds targeted, manifest-verified
authorization bootstrap state. It hard-binds the recovery entry point to the
Tenant audience and grants it only to `aether_tenant_projection_worker`.
