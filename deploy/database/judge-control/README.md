# Judge control-plane database provisioning

This directory provisions only the wrapper's PostgreSQL database. It is not a
Judge0 engine migration directory and must never be mounted into the upstream
Judge0 container.

Run `roles.sql` once on the Judge control-plane PostgreSQL cluster as a cluster
administrator:

```bash
psql --set=judge_db_name=aether_judge_wrapper \
  --file deploy/database/judge-control/roles.sql postgres
```

The script creates two `NOLOGIN`, non-superuser group roles:

- `aether_judge_migrator` owns the logical database and schema migrations.
- `aether_judge_app` has only runtime DML access and is never a table owner.

The cluster's certificate-authentication provisioning must create separate
login identities, grant the appropriate group role, and map the client
certificate subject in `pg_hba.conf`. Do not add password-bearing roles to this
repository. The migration identity must be able to `SET ROLE
aether_judge_migrator`; the runtime identity must have only
`aether_judge_app`. Run the repository migration runner (`make migrate
SVC=judge DIR=up` in a trusted build environment) with that identity. Before
opening `golang-migrate`, it creates the `public.schema_migrations` ledger as
the non-login owner and gives the migration identity only the ledger privileges
needed to record versions; it never grants `CREATE` on `public` to PUBLIC or an
application role.

Validate the result before applying migrations:

```bash
psql --set=judge_db_name=aether_judge_wrapper \
  --file deploy/database/judge-control/validate-roles.sql postgres
```

The expected result has `false` for all privileged role attributes and for
`public_can_create` / `public_can_connect`, while both service group roles have
database connectivity. Provision the three-node HA cluster through the approved
PostgreSQL operator or platform automation; this script is intentionally
topology-neutral and performs no replica initialization.
