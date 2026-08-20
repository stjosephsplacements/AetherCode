# Platform PostgreSQL HA deployment

This is the production-only chart for the platform cluster. It creates exactly
three CloudNativePG instances, requires one synchronous replica for commits,
requires one instance per dedicated PostgreSQL node, uses TLS client-certificate
authentication, and declares the nine platform databases and least-privilege
roles. Judge control-plane and Judge0 engine databases are deliberately absent.

The chart has no usable default release: it refuses to render until all four
certificate Secrets and all India-resident Barman object-store inputs are
provided. This avoids an accidental deployment with an unencrypted or
non-resident backup destination. Create a private values file through the
secrets controller, then validate it before applying:

```sh
helm template platform-postgres deploy/helm/platform-postgres-ha \
  --namespace aethercode --values /secure/platform-postgres.values.yaml
```

Install CloudNativePG `1.30.x`, cert-manager, and the Barman Cloud CNPG-I plugin
before rendering the chart. The chosen PostgreSQL 18.4 operand is pinned by OCI
digest. The operator's client-certificate role feature creates a unique
certificate Secret per migrator, app, projection-worker, Submission
completion-adapter, and Notification retention-worker identity; mount only the
corresponding Secret into each workload.

After the `DatabaseRole` and `Database` resources reconcile, run one short,
certificate-authenticated migration Job per service with its migrator identity.
The Job must invoke the repository runner (`libs/pkg/cmd/migrate`, or
`make migrate` in a trusted build environment), not a generic CLI as the
cluster administrator. The runner verifies the non-superuser/non-`BYPASSRLS`
role topology, creates the version ledger through the migrator's permitted
`SET ROLE` to the non-login database owner, and grants the migrator only the
ledger privileges required by `golang-migrate`. Record the migration Job
identity and completed version with the release evidence.

The Barman store uses encrypted WAL and base backups, daily standby-preferred
base backups, and 35-day operational backup retention. This is not the tenant
record-retention policy: retained records remain in the primary databases for
their required lifecycle. The infrastructure operator must prove India-only
placement for cluster nodes, volumes, the backup endpoint, and object replicas
before promotion.

Run [`../../runbooks/platform-postgres-ha.md`](../../runbooks/platform-postgres-ha.md)
for the restore, node-loss, and pre-promotion exercises.
