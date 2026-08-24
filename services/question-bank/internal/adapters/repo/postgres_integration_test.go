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

// TestRLSIsolateTenants proves the access boundary question-bank actually
// implements.
//
// Investigation note: question-bank has no tenant_id column anywhere in its
// schema (services/question-bank/migrations/000002_domain.up.sql) — it is a
// single global, platform-wide content bank, not a tenant-partitioned
// service. Its RLS SELECT/INSERT/UPDATE policies on qbank.questions and
// qbank.question_versions gate on authz.current_global_context_allows_read,
// but aether_question_bank_app is never GRANTed base SELECT/INSERT/UPDATE
// privilege on those tables — all reads and writes go exclusively through
// SECURITY DEFINER functions such as qbank.get_question_version, which call
// qbank.require_read_context internally. So the real, testable isolation
// boundary here is "does the signed context's actor hold a global read/write
// grant", not tenant A vs tenant B. This test proves that boundary: an
// authorized actor can read a question version, an actor with no grant at
// all cannot.
//
// Architecture of the test:
//  1. Start a real PostgreSQL 18.4 container (testcontainers).
//  2. Pre-create the required database roles and adjust schema ownership so
//     that golang-migrate can run as the postgres superuser.
//  3. Apply all question-bank service migrations via golang-migrate.
//  4. Insert one question and one draft question version as superuser
//     (superusers bypass RLS).
//  5. For each test case, open a dedicated transaction, seed the authz
//     context tables directly, switch to the aether_question_bank_app role,
//     and call qbank.get_question_version: the authorized actor succeeds, the
//     unauthorized actor is denied by qbank.require_read_context.
func TestRLSIsolateTenants(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	pool := integration.StartPostgres(ctx, t)

	// --- pre-migration role and schema setup -----------------------------------
	for _, stmt := range []string{
		`CREATE ROLE aether_question_bank_owner       NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`CREATE ROLE aether_question_bank_migrator    NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`CREATE ROLE aether_question_bank_app         NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`CREATE ROLE aether_question_bank_authz_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`CREATE ROLE aether_question_bank_projection_worker NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		// Migrator must be a member of owner so SET ROLE aether_question_bank_owner works.
		`GRANT aether_question_bank_owner TO aether_question_bank_migrator`,
		// Transfer ownership so the migration can REVOKE on the public schema.
		`ALTER DATABASE testdb OWNER TO aether_question_bank_owner`,
		`ALTER SCHEMA public OWNER TO aether_question_bank_owner`,
		// Pre-create the migration version table owned by aether_question_bank_owner.
		`CREATE TABLE public.schema_migrations (version bigint NOT NULL PRIMARY KEY, dirty boolean NOT NULL)`,
		`ALTER TABLE public.schema_migrations OWNER TO aether_question_bank_owner`,
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
	authorizedActorID := uuid.New()
	unauthorizedActorID := uuid.New()
	questionID := uuid.New()
	questionVersionID := uuid.New()

	// Insert a question and a draft version as superuser (bypasses all RLS).
	_, err = pool.Exec(ctx,
		`INSERT INTO qbank.questions (id, slug, created_by) VALUES ($1, 'rls-test-question', $2)`,
		questionID, uuid.New(),
	)
	require.NoError(t, err, "insert question")
	_, err = pool.Exec(ctx,
		`INSERT INTO qbank.question_versions
		     (id, question_id, version_number, title, prompt_markdown, difficulty,
		      supported_languages, time_limit_ms, memory_limit_kib, evaluation_bundle_object_key,
		      evaluation_bundle_checksum, encryption_key_reference, created_by)
		 VALUES ($1, $2, 1, 'RLS Test Question', 'Do the thing.', 'easy',
		         '["python3"]'::jsonb, 1000, 65536, 'bundles/rls-test.zip',
		         repeat('a', 64), 'kms://key/rls-test', $3)`,
		questionVersionID, questionID, uuid.New(),
	)
	require.NoError(t, err, "insert draft question version")

	// Grant only the authorized actor global read access.
	_, err = pool.Exec(ctx,
		`INSERT INTO authz.actor_global_authorizations (actor_id, authz_revision, can_read, can_write, active)
		 VALUES ($1, 1, true, false, true)`,
		authorizedActorID,
	)
	require.NoError(t, err, "insert authorized actor global authorization")

	// Mark the authorization projection resync as ready. Migration 000004 gates
	// has_global_authorization_at on authz.authorization_projection_ready(),
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
		name           string
		contextActorID uuid.UUID
		wantAllowed    bool
	}{
		{
			name:           "authorized actor can read the question version",
			contextActorID: authorizedActorID,
			wantAllowed:    true,
		},
		{
			name:           "unauthorized actor is denied",
			contextActorID: unauthorizedActorID,
			wantAllowed:    false,
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
			// Global contexts carry a NULL tenant_id.
			_, err = tx.Exec(ctx, `
				INSERT INTO authz.request_contexts
				    (context_id, capability_id, backend_pid, transaction_id,
				     actor_id, tenant_id, authz_revision,
				     action, resource,
				     issued_at, expires_at)
				VALUES
				    ($1, $2, pg_backend_pid(), txid_current(),
				     $3, NULL, 1,
				     'qbank.read', 'qbank.question_versions',
				     clock_timestamp(), clock_timestamp() + interval '4 seconds')`,
				contextID, capabilityID, tc.contextActorID,
			)
			require.NoError(t, err, "insert request context")

			// Point the RLS functions at our seeded context.
			_, err = tx.Exec(ctx,
				`SELECT set_config('app.authz_context_id', $1, true)`,
				contextID.String(),
			)
			require.NoError(t, err, "set authz context GUC")

			// Become the application role.
			_, err = tx.Exec(ctx, `SET LOCAL ROLE aether_question_bank_app`)
			require.NoError(t, err, "set role aether_question_bank_app")

			var got []byte
			queryErr := tx.QueryRow(ctx,
				`SELECT qbank.get_question_version($1)`, questionVersionID,
			).Scan(&got)

			if tc.wantAllowed {
				require.NoError(t, queryErr, "expected authorized actor to read the question version")
				require.NotEmpty(t, got)
				return
			}

			require.Error(t, queryErr, "expected unauthorized actor to be denied")
			var pgErr *pgconn.PgError
			require.True(t, errors.As(queryErr, &pgErr), "expected a *pgconn.PgError, got %T: %v", queryErr, queryErr)
			require.Equal(t, "42501", pgErr.Code, "expected an insufficient-privilege error, got: %s", pgErr.Message)
		})
	}
}
