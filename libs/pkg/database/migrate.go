package database

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	_ "github.com/lib/pq"
)

const migrationLedgerSchema = "public"

// MigrateUp creates the protected migration ledger, then applies every pending
// migration. The caller must be the dedicated migration login, not an owner or
// application role.
func MigrateUp(databaseURL, sourceURL string) error {
	if err := migrateWithLedger(databaseURL, sourceURL, func(migration *migrate.Migrate) error {
		return migration.Up()
	}); err != nil {
		return fmt.Errorf("apply migrations: %w", err)
	}
	return nil
}

// MigrateDown creates the protected migration ledger if necessary, then rolls
// all migrations back. It exists for disposable verification and controlled
// rollback drills; production releases use expand, backfill, and contract
// migrations instead of routine full rollback.
func MigrateDown(databaseURL, sourceURL string) error {
	if err := migrateWithLedger(databaseURL, sourceURL, func(migration *migrate.Migrate) error {
		return migration.Down()
	}); err != nil {
		return fmt.Errorf("roll back migrations: %w", err)
	}
	return nil
}

func migrateWithLedger(databaseURL, sourceURL string, operation func(*migrate.Migrate) error) error {
	if err := EnsureMigrationLedger(context.Background(), databaseURL); err != nil {
		return fmt.Errorf("ensure migration ledger: %w", err)
	}

	migration, err := migrate.New(sourceURL, databaseURL)
	if err != nil {
		return fmt.Errorf("open migrations: %w", err)
	}
	defer migration.Close()

	if err := operation(migration); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return err
	}
	return nil
}

// EnsureMigrationLedger creates public.schema_migrations under the non-login
// database owner, while connected as the dedicated migrator. It grants the
// migrator only the PostgreSQL privileges golang-migrate needs for its ledger:
// SELECT, INSERT, and TRUNCATE. No application role receives a ledger grant,
// and PUBLIC never receives CREATE on public.
//
// This must run before golang-migrate opens its PostgreSQL driver because that
// driver otherwise attempts to create the version table as the migration login.
func EnsureMigrationLedger(ctx context.Context, databaseURL string) error {
	if err := validateMigrationLedgerURL(databaseURL); err != nil {
		return err
	}

	database, err := sql.Open("postgres", databaseURL)
	if err != nil {
		return fmt.Errorf("open PostgreSQL connection: %w", err)
	}
	defer database.Close()

	if err := database.PingContext(ctx); err != nil {
		return fmt.Errorf("ping PostgreSQL connection: %w", err)
	}

	var schema string
	if err := database.QueryRowContext(ctx, "SELECT current_schema()").Scan(&schema); err != nil {
		return fmt.Errorf("read current schema: %w", err)
	}
	if schema != migrationLedgerSchema {
		return fmt.Errorf("migration connection must use %q as its current schema, got %q", migrationLedgerSchema, schema)
	}

	transaction, err := database.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin migration ledger transaction: %w", err)
	}
	defer transaction.Rollback()

	if _, err := transaction.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", "aethercode:migration-ledger"); err != nil {
		return fmt.Errorf("lock migration ledger bootstrap: %w", err)
	}

	identity, err := readMigrationLedgerIdentity(ctx, transaction)
	if err != nil {
		return err
	}
	if err := identity.validate(); err != nil {
		return err
	}

	if _, err := transaction.ExecContext(ctx, "SET LOCAL ROLE "+identity.ownerIdentifier); err != nil {
		return fmt.Errorf("assume database owner for migration ledger: %w", err)
	}
	if _, err := transaction.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS public.schema_migrations (
        version bigint NOT NULL PRIMARY KEY,
        dirty boolean NOT NULL
    )`); err != nil {
		return fmt.Errorf("create migration ledger: %w", err)
	}

	var ledgerOwner string
	if err := transaction.QueryRowContext(ctx, `
        SELECT pg_get_userbyid(class.relowner)
        FROM pg_class AS class
        JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
        WHERE namespace.nspname = 'public'
          AND class.relname = 'schema_migrations'
          AND class.relkind = 'r'
    `).Scan(&ledgerOwner); err != nil {
		return fmt.Errorf("read migration ledger owner: %w", err)
	}
	if ledgerOwner != identity.ownerName {
		return fmt.Errorf("migration ledger owner %q must be database owner %q", ledgerOwner, identity.ownerName)
	}

	if _, err := transaction.ExecContext(ctx, "REVOKE ALL PRIVILEGES ON TABLE public.schema_migrations FROM PUBLIC"); err != nil {
		return fmt.Errorf("revoke public migration ledger privileges: %w", err)
	}
	if _, err := transaction.ExecContext(ctx, "REVOKE ALL PRIVILEGES ON TABLE public.schema_migrations FROM "+identity.migratorIdentifier); err != nil {
		return fmt.Errorf("revoke excess migration ledger privileges: %w", err)
	}
	if _, err := transaction.ExecContext(ctx, "GRANT SELECT, INSERT, TRUNCATE ON TABLE public.schema_migrations TO "+identity.migratorIdentifier); err != nil {
		return fmt.Errorf("grant migration ledger privileges: %w", err)
	}

	if err := transaction.Commit(); err != nil {
		return fmt.Errorf("commit migration ledger bootstrap: %w", err)
	}
	return nil
}

type migrationLedgerIdentity struct {
	migratorName       string
	migratorIdentifier string
	ownerName          string
	ownerIdentifier    string
	migratorSuperuser  bool
	migratorBypassRLS  bool
	migratorCanLogin   bool
	ownerSuperuser     bool
	ownerBypassRLS     bool
	ownerCanLogin      bool
	canAssumeOwner     bool
	ownerCanCreate     bool
}

func readMigrationLedgerIdentity(ctx context.Context, transaction *sql.Tx) (migrationLedgerIdentity, error) {
	var identity migrationLedgerIdentity
	err := transaction.QueryRowContext(ctx, `
        SELECT current_user,
               quote_ident(current_user),
               pg_get_userbyid(database.datdba),
               quote_ident(pg_get_userbyid(database.datdba)),
               migrator.rolsuper,
               migrator.rolbypassrls,
               migrator.rolcanlogin,
               owner.rolsuper,
               owner.rolbypassrls,
               owner.rolcanlogin,
               pg_has_role(current_user, pg_get_userbyid(database.datdba), 'MEMBER'),
               has_schema_privilege(pg_get_userbyid(database.datdba), 'public', 'CREATE')
        FROM pg_database AS database
        JOIN pg_roles AS migrator ON migrator.rolname = current_user
        JOIN pg_roles AS owner ON owner.oid = database.datdba
        WHERE database.datname = current_database()
    `).Scan(
		&identity.migratorName,
		&identity.migratorIdentifier,
		&identity.ownerName,
		&identity.ownerIdentifier,
		&identity.migratorSuperuser,
		&identity.migratorBypassRLS,
		&identity.migratorCanLogin,
		&identity.ownerSuperuser,
		&identity.ownerBypassRLS,
		&identity.ownerCanLogin,
		&identity.canAssumeOwner,
		&identity.ownerCanCreate,
	)
	if err != nil {
		return migrationLedgerIdentity{}, fmt.Errorf("read migration role topology: %w", err)
	}
	return identity, nil
}

func (identity migrationLedgerIdentity) validate() error {
	switch {
	case identity.migratorName == identity.ownerName:
		return fmt.Errorf("migration login %q must be distinct from database owner", identity.migratorName)
	case !identity.migratorCanLogin:
		return fmt.Errorf("migration role %q must be a login role", identity.migratorName)
	case identity.migratorSuperuser || identity.migratorBypassRLS:
		return fmt.Errorf("migration role %q must not be superuser or BYPASSRLS", identity.migratorName)
	case identity.ownerCanLogin:
		return fmt.Errorf("database owner %q must be a non-login role", identity.ownerName)
	case identity.ownerSuperuser || identity.ownerBypassRLS:
		return fmt.Errorf("database owner %q must not be superuser or BYPASSRLS", identity.ownerName)
	case !identity.canAssumeOwner:
		return fmt.Errorf("migration role %q cannot SET ROLE to database owner %q", identity.migratorName, identity.ownerName)
	case !identity.ownerCanCreate:
		return fmt.Errorf("database owner %q cannot create the migration ledger in public", identity.ownerName)
	default:
		return nil
	}
}

func validateMigrationLedgerURL(databaseURL string) error {
	parsed, err := url.Parse(databaseURL)
	if err != nil {
		return fmt.Errorf("parse PostgreSQL migration URL: %w", err)
	}
	if parsed.Scheme != "postgres" && parsed.Scheme != "postgresql" {
		return fmt.Errorf("migration URL must use postgres or postgresql scheme")
	}
	if parsed.Query().Get("x-migrations-table") != "" || parsed.Query().Get("x-migrations-table-quoted") != "" {
		return fmt.Errorf("custom golang-migrate version tables are not supported; use public.schema_migrations")
	}
	return nil
}
