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

// TestRLSIsolateTenants proves that Row-Level Security in the user service
// correctly isolates rows by tenant: a context scoped to tenant A cannot read
// rows that belong to tenant B.
//
// Architecture of the test:
//  1. Start a real PostgreSQL 18.4 container (testcontainers).
//  2. Pre-create the required database roles and adjust schema ownership so
//     that golang-migrate can run as the postgres superuser.
//  3. Apply all user service migrations via golang-migrate.
//  4. Insert one student row for tenant A as superuser (superusers bypass RLS).
//  5. For each test case, open a dedicated transaction, seed the authz context
//     tables directly (bypassing the HMAC gate — valid only in ephemeral
//     containers), switch to the aether_user_app role, and assert the row count.
func TestRLSIsolateTenants(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	pool := integration.StartPostgres(ctx, t)

	// --- pre-migration role and schema setup -----------------------------------
	// The user service bootstrap migration starts with SET ROLE aether_user_owner
	// and validates that the five service roles exist. We create them here as the
	// postgres superuser, mirroring what deploy/database/platform/dev-init.sh
	// does in production before any migration runs.
	//
	// schema_migrations is pre-created and owned by aether_user_owner because
	// golang-migrate's bookkeeping INSERT runs inside the same transaction as the
	// migration SQL — after SET ROLE aether_user_owner has taken effect.
	for _, stmt := range []string{
		`CREATE ROLE aether_user_owner       NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`CREATE ROLE aether_user_migrator    NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`CREATE ROLE aether_user_app         NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`CREATE ROLE aether_user_authz_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`CREATE ROLE aether_user_projection_worker NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		// Migrator must be a member of owner so SET ROLE aether_user_owner works.
		`GRANT aether_user_owner TO aether_user_migrator`,
		// Transfer ownership so the migration can REVOKE on the public schema.
		`ALTER DATABASE testdb OWNER TO aether_user_owner`,
		`ALTER SCHEMA public OWNER TO aether_user_owner`,
		// Pre-create the migration version table owned by aether_user_owner.
		`CREATE TABLE public.schema_migrations (version bigint NOT NULL PRIMARY KEY, dirty boolean NOT NULL)`,
		`ALTER TABLE public.schema_migrations OWNER TO aether_user_owner`,
	} {
		_, err := pool.Exec(ctx, stmt)
		require.NoError(t, err, "pre-migration setup: %s", stmt[:min(len(stmt), 60)])
	}

	// --- apply migrations ------------------------------------------------------
	_, file, _, _ := runtime.Caller(0)
	// Walk three directories up from this file to reach services/user/.
	svcRoot := filepath.Join(filepath.Dir(file), "../../..")
	migrationsDir, err := filepath.Abs(filepath.Join(svcRoot, "migrations"))
	require.NoError(t, err)
	integration.ApplyMigrations(ctx, t, pool, migrationsDir)

	// --- committed test data ---------------------------------------------------
	tenantA := uuid.MustParse("018f4b0d-08f8-7c09-9ba7-efdf9c330001")
	tenantB := uuid.MustParse("018f4b0d-08f8-7c09-9ba7-efdf9c330002")
	actorID := uuid.New()
	studentID := uuid.New()
	principalID := uuid.New()
	grantSourceID := uuid.New() // non-NULL required by actor_tenant_authorizations CHECK

	// Insert a student for tenant A. The postgres superuser bypasses all RLS.
	_, err = pool.Exec(ctx,
		`INSERT INTO users.students (id, principal_id, tenant_id, enrollment_number, status)
		 VALUES ($1, $2, $3, 'RLIST-001', 'active')`,
		studentID, principalID, tenantA,
	)
	require.NoError(t, err, "insert tenant A student")

	// Grant the test actor access to tenant A so the RLS SECURITY DEFINER
	// function can find a matching authorization row.
	_, err = pool.Exec(ctx,
		`INSERT INTO authz.actor_tenant_authorizations
		     (actor_id, tenant_id, authz_revision, is_authorized, grant_kind, grant_source_id)
		 VALUES ($1, $2, 1, true, 'tenant', $3)`,
		actorID, tenantA, grantSourceID,
	)
	require.NoError(t, err, "insert actor tenant A authorization")

	// --- table-driven RLS assertions ------------------------------------------
	tests := []struct {
		name            string
		contextTenantID uuid.UUID
		wantCount       int
	}{
		{
			name:            "tenantA context sees its own row",
			contextTenantID: tenantA,
			wantCount:       1,
		},
		{
			name:            "tenantB context sees zero rows",
			contextTenantID: tenantB,
			wantCount:       0,
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			// Each sub-test uses its own transaction so authz context is fresh.
			tx, err := pool.Begin(ctx)
			require.NoError(t, err)
			defer tx.Rollback(ctx) //nolint:errcheck

			capabilityID := uuid.New()
			contextID := uuid.New()

			// Seed an authz context row directly (bypasses the HMAC gate).
			// pg_backend_pid() and txid_current() are captured at INSERT time
			// and will match the values the SECURITY DEFINER RLS functions see
			// because all statements share the same transaction on the same
			// backend connection.
			_, err = tx.Exec(ctx, `
				INSERT INTO authz.request_contexts
				    (context_id, capability_id, backend_pid, transaction_id,
				     actor_id, tenant_id, authz_revision,
				     action, resource,
				     issued_at, expires_at)
				VALUES
				    ($1, $2, pg_backend_pid(), txid_current(),
				     $3, $4, 1,
				     'user.read', 'users.students',
				     clock_timestamp(), clock_timestamp() + interval '4 seconds')`,
				contextID, capabilityID, actorID, tc.contextTenantID,
			)
			require.NoError(t, err, "insert request context")

			// Point the RLS functions at our seeded context.
			_, err = tx.Exec(ctx,
				`SELECT set_config('app.authz_context_id', $1, true)`,
				contextID.String(),
			)
			require.NoError(t, err, "set authz context GUC")

			// Become the application role so RLS policies are evaluated.
			_, err = tx.Exec(ctx, `SET LOCAL ROLE aether_user_app`)
			require.NoError(t, err, "set role aether_user_app")

			var count int
			err = tx.QueryRow(ctx, `SELECT count(*) FROM users.students`).Scan(&count)
			require.NoError(t, err, "select count")

			if count != tc.wantCount {
				t.Fatalf("RLS isolation failure (%s): expected %d row(s), got %d",
					tc.name, tc.wantCount, count)
			}
		})
	}
}
