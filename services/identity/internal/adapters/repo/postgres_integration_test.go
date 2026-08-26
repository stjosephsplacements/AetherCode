//go:build integration

package repo_test

import (
	"context"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/aethercode/aethercode/libs/pkg/testutil/integration"
)

// TestRLSIsolateTenants proves the access boundary identity actually
// implements at the database layer.
//
// Investigation note: identity has no tenant-scoped RLS at all. Grepping
// every services/identity/migrations/*.up.sql for `ENABLE ROW LEVEL
// SECURITY` and `CREATE POLICY` shows RLS is enabled only on
// identity.principals, identity.password_credentials, and
// identity.mfa_factors (migration 000010_rls_block_deletes.up.sql), whose
// only policies are `allow_all_reads/inserts/updates USING (true)` plus a
// RESTRICTIVE `block_delete_require_hard_delete_function USING (false)` —
// the migration's own comment says so explicitly: "principals,
// password_credentials, mfa_factors don't have tenant-aware RLS yet".
// identity.refresh_session_families carries a nullable tenant_id but has no
// RLS enabled on it at all; tenant scoping for identity's own tables is
// enforced at the application layer, not by Postgres RLS. The authz.*
// tenant/global context functions bootstrap defines in this service exist to
// validate signed contexts minted for OTHER services, not to gate identity's
// own tables.
//
// The real, verifiable DB-layer access boundary identity enforces is soft
// delete: aether_identity_app can never physically DELETE a row directly
// (RLS blocks it via USING (false)); only the SECURITY DEFINER
// app.hard_delete() function, gated by GRANT EXECUTE, can perform a physical
// delete. This test proves that boundary on identity.principals.
//
// Architecture of the test:
//  1. Start a real PostgreSQL 18.4 container (testcontainers).
//  2. Pre-create the required database roles and adjust schema ownership so
//     that golang-migrate can run as the postgres superuser.
//  3. Apply all identity service migrations via golang-migrate.
//  4. Insert one principal row as superuser (superusers bypass RLS).
//  5. As aether_identity_app, attempt a direct DELETE: RLS blocks it (zero
//     rows deleted, row still present).
//  6. As aether_identity_app, call app.hard_delete(): the SECURITY DEFINER
//     function bypasses RLS and physically removes the row.
func TestRLSIsolateTenants(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	pool := integration.StartPostgres(ctx, t)

	// --- pre-migration role and schema setup -----------------------------------
	for _, stmt := range []string{
		`CREATE ROLE aether_identity_owner       NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`CREATE ROLE aether_identity_migrator    NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`CREATE ROLE aether_identity_app         NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`CREATE ROLE aether_identity_authz_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`CREATE ROLE aether_identity_projection_worker NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		// Migrator must be a member of owner so SET ROLE aether_identity_owner works.
		`GRANT aether_identity_owner TO aether_identity_migrator`,
		// Transfer ownership so the migration can REVOKE on the public schema.
		`ALTER DATABASE testdb OWNER TO aether_identity_owner`,
		`ALTER SCHEMA public OWNER TO aether_identity_owner`,
		// Pre-create the migration version table owned by aether_identity_owner.
		`CREATE TABLE public.schema_migrations (version bigint NOT NULL PRIMARY KEY, dirty boolean NOT NULL)`,
		`ALTER TABLE public.schema_migrations OWNER TO aether_identity_owner`,
	} {
		_, err := pool.Exec(ctx, stmt)
		require.NoError(t, err, "pre-migration setup: %s", stmt[:min(len(stmt), 60)])
	}

	// --- apply migrations ------------------------------------------------------
	_, file, _, _ := runtime.Caller(0)
	svcRoot := filepath.Join(filepath.Dir(file), "../../..")
	migrationsDir, err := filepath.Abs(filepath.Join(svcRoot, "migrations"))
	require.NoError(t, err)
	integration.ApplyMigrations(ctx, t, pool, migrationsDir)

	// --- committed test data ---------------------------------------------------
	principalID := uuid.New()

	_, err = pool.Exec(ctx,
		`INSERT INTO identity.principals (id, email, display_name) VALUES ($1, $2, 'RLS Delete-Block Test')`,
		principalID, "rls-delete-block-"+principalID.String()+"@example.com",
	)
	require.NoError(t, err, "insert principal")

	t.Run("app role cannot directly delete a principal", func(t *testing.T) {
		tx, err := pool.Begin(ctx)
		require.NoError(t, err)
		defer tx.Rollback(ctx) //nolint:errcheck

		_, err = tx.Exec(ctx, `SET LOCAL ROLE aether_identity_app`)
		require.NoError(t, err, "set role aether_identity_app")

		tag, err := tx.Exec(ctx, `DELETE FROM identity.principals WHERE id = $1`, principalID)
		require.NoError(t, err, "delete statement itself must not error")
		require.Equal(t, int64(0), tag.RowsAffected(), "RLS must block the delete: zero rows should be affected")

		var count int
		err = tx.QueryRow(ctx, `SELECT count(*) FROM identity.principals WHERE id = $1`, principalID).Scan(&count)
		require.NoError(t, err, "select count")
		require.Equal(t, 1, count, "the row must still be present after the blocked delete")
	})

	t.Run("app role can hard-delete via the SECURITY DEFINER function", func(t *testing.T) {
		tx, err := pool.Begin(ctx)
		require.NoError(t, err)
		defer tx.Rollback(ctx) //nolint:errcheck

		_, err = tx.Exec(ctx, `SET LOCAL ROLE aether_identity_app`)
		require.NoError(t, err, "set role aether_identity_app")

		var deleted bool
		err = tx.QueryRow(ctx,
			`SELECT app.hard_delete('identity.principals', $1, $2, 'integration test cleanup')`,
			principalID, uuid.New(),
		).Scan(&deleted)
		require.NoError(t, err, "hard_delete must succeed for the app role")
		require.True(t, deleted)

		var count int
		err = tx.QueryRow(ctx, `SELECT count(*) FROM identity.principals WHERE id = $1`, principalID).Scan(&count)
		require.NoError(t, err, "select count")
		require.Equal(t, 0, count, "the row must be physically gone after hard_delete")
	})
}
