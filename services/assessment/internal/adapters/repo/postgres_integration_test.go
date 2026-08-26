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

// TestRLSIsolateTenants proves that Row-Level Security in the assessment
// service correctly isolates rows by tenant: a context scoped to tenant A
// cannot read rows that belong to tenant B.
//
// Architecture of the test:
//  1. Start a real PostgreSQL 18.4 container (testcontainers).
//  2. Pre-create the required database roles and adjust schema ownership so
//     that golang-migrate can run as the postgres superuser.
//  3. Apply all assessment service migrations via golang-migrate.
//  4. Insert one exam row for tenant A as superuser (superusers bypass RLS).
//  5. For each test case, open a dedicated transaction, seed the authz context
//     tables directly (bypassing the HMAC gate — valid only in ephemeral
//     containers), switch to the aether_assessment_app role, and assert the
//     row count.
//
// Investigation note: assessment's has_tenant_authorization_at was redefined
// twice after bootstrap. Migration 000004 moved it from reading
// authz.actor_tenant_authorizations directly to joining
// authz.principal_authorization_revisions with authz.authorization_grants.
// Migration 000008 layered a further authz.authorization_projection_ready()
// gate on top: the resync-state singleton row defaults projection_ready to
// false, so the seed below must explicitly mark it ready (with the NOT NULL
// companion columns its CHECK constraint requires) or every RLS read is
// denied regardless of grants.
func TestRLSIsolateTenants(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	pool := integration.StartPostgres(ctx, t)

	// --- pre-migration role and schema setup -----------------------------------
	for _, stmt := range []string{
		`CREATE ROLE aether_assessment_owner       NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`CREATE ROLE aether_assessment_migrator    NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`CREATE ROLE aether_assessment_app         NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`CREATE ROLE aether_assessment_authz_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`CREATE ROLE aether_assessment_projection_worker NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		// Migrator must be a member of owner so SET ROLE aether_assessment_owner works.
		`GRANT aether_assessment_owner TO aether_assessment_migrator`,
		// Transfer ownership so the migration can REVOKE on the public schema.
		`ALTER DATABASE testdb OWNER TO aether_assessment_owner`,
		`ALTER SCHEMA public OWNER TO aether_assessment_owner`,
		// Pre-create the migration version table owned by aether_assessment_owner.
		`CREATE TABLE public.schema_migrations (version bigint NOT NULL PRIMARY KEY, dirty boolean NOT NULL)`,
		`ALTER TABLE public.schema_migrations OWNER TO aether_assessment_owner`,
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
	tenantA := uuid.MustParse("018f4b0d-08f8-7c09-9ba7-efdf9c330001")
	tenantB := uuid.MustParse("018f4b0d-08f8-7c09-9ba7-efdf9c330002")
	actorID := uuid.New()
	examID := uuid.New()
	createdBy := uuid.New()

	// Insert an exam for tenant A. The postgres superuser bypasses all RLS.
	_, err = pool.Exec(ctx,
		`INSERT INTO assessment.exams (id, tenant_id, external_reference, created_by)
		 VALUES ($1, $2, 'RLIST-001', $3)`,
		examID, tenantA, createdBy,
	)
	require.NoError(t, err, "insert tenant A exam")

	// Seed the actor's authorization grant snapshot. Live has_tenant_authorization_at
	// (migration 000004 onward) joins these two tables, not
	// authz.actor_tenant_authorizations.
	_, err = pool.Exec(ctx,
		`INSERT INTO authz.principal_authorization_revisions (actor_id, authz_revision) VALUES ($1, 1)`,
		actorID,
	)
	require.NoError(t, err, "insert actor authorization revision snapshot")
	_, err = pool.Exec(ctx,
		`INSERT INTO authz.authorization_grants (actor_id, tenant_id, grant_kind, grant_source_id, authz_revision)
		 VALUES ($1, $2, 'tenant', $2, 1)`,
		actorID, tenantA,
	)
	require.NoError(t, err, "insert actor tenant A authorization grant")

	// Mark the authorization projection resync as ready. Migration 000008 gates
	// has_tenant_authorization_at on authz.authorization_projection_ready(),
	// which reads this singleton row; it defaults to not-ready and its CHECK
	// constraint requires the companion columns once ready is true.
	_, err = pool.Exec(ctx,
		`UPDATE authz.authorization_projection_resync_state
		 SET projection_ready = true,
		     active_resync_id = gen_random_uuid(),
		     completion_event_id = gen_random_uuid(),
		     expected_snapshot_count = 0,
		     expected_manifest_sha256 = decode(repeat('00', 32), 'hex')
		 WHERE singleton = true`,
	)
	require.NoError(t, err, "mark authorization projection ready")

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
			_, err = tx.Exec(ctx, `
				INSERT INTO authz.request_contexts
				    (context_id, capability_id, backend_pid, transaction_id,
				     actor_id, tenant_id, authz_revision,
				     action, resource,
				     issued_at, expires_at)
				VALUES
				    ($1, $2, pg_backend_pid(), txid_current(),
				     $3, $4, 1,
				     'assessment.read', 'assessment.exams',
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
			_, err = tx.Exec(ctx, `SET LOCAL ROLE aether_assessment_app`)
			require.NoError(t, err, "set role aether_assessment_app")

			var count int
			err = tx.QueryRow(ctx, `SELECT count(*) FROM assessment.exams`).Scan(&count)
			require.NoError(t, err, "select count")

			if count != tc.wantCount {
				t.Fatalf("RLS isolation failure (%s): expected %d row(s), got %d",
					tc.name, tc.wantCount, count)
			}
		})
	}
}
