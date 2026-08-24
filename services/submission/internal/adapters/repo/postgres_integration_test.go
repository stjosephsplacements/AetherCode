//go:build integration

package repo_test

import (
	"context"
	"errors"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/require"

	"github.com/aethercode/aethercode/libs/pkg/testutil/integration"
)

// TestRLSIsolateTenants proves that tenant isolation in the submission
// service correctly blocks cross-tenant reads.
//
// Investigation note: unlike user/assessment/tenant, submission migration
// 000005 REVOKEs all direct SELECT/INSERT/UPDATE table privileges on
// submission.attempts (and its sibling domain tables) from
// aether_submission_app — the app role retains only the RLS-blocked DELETE
// grant added later. All reads go through SECURITY DEFINER functions such as
// submission.get_attempt_for_candidate, which enforces the same tenant
// boundary explicitly (via authz.current_context_allows_read) rather than via
// a directly queryable RLS SELECT policy. This test therefore exercises that
// function — the actual production access path — instead of a raw
// `SET LOCAL ROLE; SELECT count(*)`, which would fail with "permission
// denied for table attempts" regardless of tenant context.
//
// Architecture of the test:
//  1. Start a real PostgreSQL 18.4 container (testcontainers).
//  2. Pre-create the required database roles. Submission needs six: the
//     usual five plus aether_submission_judge_adapter, required by migration
//     000010 (judge completion bridge). Adjust schema ownership so
//     golang-migrate can run as the postgres superuser.
//  3. Apply all submission service migrations via golang-migrate.
//  4. Insert one attempt row for tenant A, owned by a candidate actor, as
//     superuser (superusers bypass RLS).
//  5. For each test case, open a dedicated transaction, seed the authz
//     context tables directly, switch to the aether_submission_app role, and
//     call submission.get_attempt_for_candidate for tenant A's attempt: a
//     context scoped to tenant A succeeds, a context scoped to tenant B is
//     rejected by the signed-context check before any row is read.
func TestRLSIsolateTenants(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	pool := integration.StartPostgres(ctx, t)

	// --- pre-migration role and schema setup -----------------------------------
	for _, stmt := range []string{
		`CREATE ROLE aether_submission_owner       NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`CREATE ROLE aether_submission_migrator    NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`CREATE ROLE aether_submission_app         NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`CREATE ROLE aether_submission_authz_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`CREATE ROLE aether_submission_projection_worker NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		// A separate runtime identity required by migration 000010 (judge
		// completion bridge); it never touches candidate tables directly.
		`CREATE ROLE aether_submission_judge_adapter NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		// Migrator must be a member of owner so SET ROLE aether_submission_owner works.
		`GRANT aether_submission_owner TO aether_submission_migrator`,
		// Transfer ownership so the migration can REVOKE on the public schema.
		`ALTER DATABASE testdb OWNER TO aether_submission_owner`,
		`ALTER SCHEMA public OWNER TO aether_submission_owner`,
		// Pre-create the migration version table owned by aether_submission_owner.
		`CREATE TABLE public.schema_migrations (version bigint NOT NULL PRIMARY KEY, dirty boolean NOT NULL)`,
		`ALTER TABLE public.schema_migrations OWNER TO aether_submission_owner`,
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
	actorID := uuid.New() // also the candidate: get_attempt_for_candidate requires candidate_id = actor_id
	attemptID := uuid.New()

	// Insert an attempt for tenant A. The postgres superuser bypasses all RLS.
	_, err = pool.Exec(ctx,
		`INSERT INTO submission.attempts
		     (id, tenant_id, exam_id, exam_version_id, candidate_id, candidate_assignment_id,
		      attempt_number, available_from, submission_deadline)
		 VALUES ($1, $2, $3, $4, $5, $6, 1, clock_timestamp(), clock_timestamp() + interval '1 hour')`,
		attemptID, tenantA, uuid.New(), uuid.New(), actorID, uuid.New(),
	)
	require.NoError(t, err, "insert tenant A attempt")

	// Grant the test actor access to tenant A so the RLS SECURITY DEFINER
	// function can find a matching authorization row.
	_, err = pool.Exec(ctx,
		`INSERT INTO authz.actor_tenant_authorizations
		     (actor_id, tenant_id, authz_revision, is_authorized, grant_kind, grant_source_id)
		 VALUES ($1, $2, 1, true, 'tenant', $2)`,
		actorID, tenantA,
	)
	require.NoError(t, err, "insert actor tenant A authorization")
	_, err = pool.Exec(ctx,
		`INSERT INTO authz.principal_authorization_revisions (actor_id, authz_revision) VALUES ($1, 1)`,
		actorID,
	)
	require.NoError(t, err, "insert actor authorization revision snapshot")

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

	// --- table-driven assertions ------------------------------------------
	tests := []struct {
		name            string
		contextTenantID uuid.UUID
		wantAllowed     bool
	}{
		{
			name:            "tenantA context can read tenant A's attempt",
			contextTenantID: tenantA,
			wantAllowed:     true,
		},
		{
			name:            "tenantB context is denied tenant A's attempt",
			contextTenantID: tenantB,
			wantAllowed:     false,
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
				     'submission.read', 'submission.attempts',
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

			// Become the application role.
			_, err = tx.Exec(ctx, `SET LOCAL ROLE aether_submission_app`)
			require.NoError(t, err, "set role aether_submission_app")

			// Always request tenant A's attempt; only the signed context's
			// tenant scope (set above) should determine whether it is visible.
			var gotID uuid.UUID
			queryErr := tx.QueryRow(ctx,
				`SELECT id FROM submission.get_attempt_for_candidate($1, $2)`,
				tenantA, attemptID,
			).Scan(&gotID)

			if tc.wantAllowed {
				require.NoError(t, queryErr, "expected tenant-scoped context to read the attempt")
				require.Equal(t, attemptID, gotID)
				return
			}

			require.Error(t, queryErr, "expected mismatched tenant context to be denied")
			var pgErr *pgconn.PgError
			require.True(t, errors.As(queryErr, &pgErr), "expected a *pgconn.PgError, got %T: %v", queryErr, queryErr)
			require.Equal(t, "42501", pgErr.Code, "expected an insufficient-privilege error, got: %s", pgErr.Message)
		})
	}
}
