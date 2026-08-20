# Platform PostgreSQL bootstrap

`dev-init.sh` creates local development roles and the nine platform databases
when the PostgreSQL volume is first initialized. Each database has a non-login
owner, a dedicated migrator, a runtime app identity, and a separate
`*_projection_worker` identity for the event-fed authorization projection.
Submission also has `aether_submission_judge_adapter`, an execute-only
completion-bridge identity; it is not an app or projection credential.
Notification likewise has
`aether_notification_retention_worker`, an execute-only retention identity
that cannot read or mutate Notification tables directly. This is not a
production provisioner: production roles use per-role client certificates,
while KMS-managed authorization keys, replication, certificates, and backup
destinations are provisioned through the three-node HA deployment process.

Run service migrations only with the corresponding migrator credential through
`make migrate SVC=<service> DIR=up`. The shared runner first creates the
`public.schema_migrations` ledger under the non-login owner by using the
migrator's explicitly granted `SET ROLE`; the ledger grants that login only
`SELECT`, `INSERT`, and `TRUNCATE`. This preserves the `PUBLIC`-without-CREATE
boundary while letting `golang-migrate` acquire its advisory lock and record
versions. Do not run the generic migration CLI as the bootstrap superuser.

The migration SQL explicitly assumes the owner role, so newly created relations
are not owned by the login role. Runtime applications use the application
credential and must never own tables, create schemas, update authorization
projections, or have `BYPASSRLS`.
