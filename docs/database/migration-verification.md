# Migration verification

Run the complete database migration check from the repository root:

```sh
make test-migrations
```

The verifier starts a uniquely named, disposable `postgres:18.4` container on
an ephemeral loopback port. It uses the existing platform bootstrap and Judge
control-plane role setup, then builds the repository migration runner. For all
nine platform databases and the isolated Judge wrapper database it:

1. connects as the dedicated non-superuser migrator;
2. applies all migrations from an empty database;
3. verifies `public.schema_migrations` is owner-owned, app-inaccessible, and
   grants the migrator only `SELECT`, `INSERT`, and `TRUNCATE`;
4. rolls all migrations back; and
5. applies them again.

The script also proves that the bootstrap superuser is rejected by the shared
migration runner. It restarts its disposable PostgreSQL container after the
cycles and verifies every platform database retains the logged
`authz.consumed_capabilities` replay ledger (including the expiry index) while
the request-context table remains unlogged with a unique capability claim. It
creates no host database or volume and removes only its own labeled container
and temporary runner binary on exit. It never targets a developer compose
database or any existing validation container.

For an individual service, set a `DATABASE_URL` for that service's migrator
certificate/credential and run:

```sh
make migrate SVC=tenant DIR=up
```

The shared runner pre-creates the `golang-migrate` version ledger by entering
the migrator's explicitly granted non-login owner role inside a short advisory-
locked transaction. `PUBLIC` retains no `CREATE` privilege on `public`, and no
application role is granted ledger access.
