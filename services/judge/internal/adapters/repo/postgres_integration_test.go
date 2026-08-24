//go:build integration

package repo_test

import (
	"context"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/aethercode/aethercode/libs/pkg/testutil/integration"
)

// TestRLSIsolateTenants proves the access boundary judge actually implements
// at the database layer.
//
// Investigation note: judge's schema is not tenant-partitioned the way
// user/assessment/tenant/submission are. judge.execution_jobs carries a
// tenant_fairness_key text column (used only for dispatch fairness, not RLS)
// rather than a tenant_id column, and judge has no authz.* context/grant
// machinery at all — only two roles exist (aether_judge_migrator,
// aether_judge_app; see services/judge/migrations/000001_judge_control_schema.up.sql).
// Grepping every services/judge/migrations/*.up.sql for `ENABLE ROW LEVEL
// SECURITY` shows RLS is enabled only on judge.execution_jobs and
// judge.language_mappings (000005_rls_block_deletes.up.sql), whose only
// policies are `allow_all_reads/inserts/updates USING (true)` plus a
// RESTRICTIVE delete-block `USING (false)` — the same soft-delete pattern
// used elsewhere in the codebase, not a per-tenant isolation policy.
//
// The real, verifiable DB-layer access boundary judge enforces is soft
// delete: aether_judge_app can never physically DELETE a row directly (RLS
// blocks it); only the SECURITY DEFINER app.hard_delete() function can
// perform a physical delete. This test proves that boundary on
// judge.execution_jobs (app.hard_delete requires an `id uuid` primary key
// column, which judge.language_mappings lacks — it is keyed by
// language_key text).
//
// Architecture of the test:
//  1. Start a real PostgreSQL 18.4 container (testcontainers).
//  2. Pre-create the two required database roles. Judge has no separate
//     owner role: aether_judge_migrator both migrates and owns the schema
//     (SET ROLE aether_judge_migrator; CREATE SCHEMA ... AUTHORIZATION
//     aether_judge_migrator), so it is granted database/schema ownership
//     directly instead of via an intermediate owner role.
//  3. Apply all judge service migrations via golang-migrate.
//  4. Insert one execution job row as superuser (superusers bypass RLS).
//  5. As aether_judge_app, attempt a direct DELETE: RLS blocks it (zero rows
//     deleted, row still present).
//  6. As aether_judge_app, call app.hard_delete(): the SECURITY DEFINER
//     function bypasses RLS and physically removes the row.
func TestRLSIsolateTenants(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	pool := integration.StartPostgres(ctx, t)

	// --- pre-migration role and schema setup -----------------------------------
	for _, stmt := range []string{
		`CREATE ROLE aether_judge_migrator NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`CREATE ROLE aether_judge_app      NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		// Judge has no owner role; the migrator itself owns the database and
		// public schema so it can CREATE SCHEMA judge and REVOKE on public.
		`ALTER DATABASE testdb OWNER TO aether_judge_migrator`,
		`ALTER SCHEMA public OWNER TO aether_judge_migrator`,
		// Pre-create the migration version table owned by aether_judge_migrator.
		`CREATE TABLE public.schema_migrations (version bigint NOT NULL PRIMARY KEY, dirty boolean NOT NULL)`,
		`ALTER TABLE public.schema_migrations OWNER TO aether_judge_migrator`,
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
	jobID := uuid.New()

	_, err = pool.Exec(ctx,
		`INSERT INTO judge.execution_jobs
		     (id, idempotency_key, request_fingerprint, tenant_fairness_key, submission_correlation_id,
		      evaluation_bundle_ref, evaluation_bundle_sha256, source_ciphertext_ref, source_ciphertext_sha256,
		      request_ciphertext_ref, language_key, cpu_time_limit_ms, wall_time_limit_ms, memory_limit_bytes,
		      process_limit, expires_at)
		 VALUES ($1, $2, $3, 'rls-test-tenant:rls-test-exam', $4,
		         'bundles/rls-test', $5, 'ciphertext/rls-test', $6,
		         'request/rls-test', 'python3', 1000, 2000, 268435456,
		         1, $7)`,
		jobID, "rls-test-"+jobID.String(), deterministicHex64("fingerprint"), uuid.New(),
		deterministicHex64("bundle"), deterministicHex64("source"), time.Now().Add(time.Hour),
	)
	require.NoError(t, err, "insert execution job")

	t.Run("app role cannot directly delete an execution job", func(t *testing.T) {
		tx, err := pool.Begin(ctx)
		require.NoError(t, err)
		defer tx.Rollback(ctx) //nolint:errcheck

		_, err = tx.Exec(ctx, `SET LOCAL ROLE aether_judge_app`)
		require.NoError(t, err, "set role aether_judge_app")

		tag, err := tx.Exec(ctx, `DELETE FROM judge.execution_jobs WHERE id = $1`, jobID)
		require.NoError(t, err, "delete statement itself must not error")
		require.Equal(t, int64(0), tag.RowsAffected(), "RLS must block the delete: zero rows should be affected")

		var count int
		err = tx.QueryRow(ctx, `SELECT count(*) FROM judge.execution_jobs WHERE id = $1`, jobID).Scan(&count)
		require.NoError(t, err, "select count")
		require.Equal(t, 1, count, "the row must still be present after the blocked delete")
	})

	t.Run("app role can hard-delete via the SECURITY DEFINER function", func(t *testing.T) {
		tx, err := pool.Begin(ctx)
		require.NoError(t, err)
		defer tx.Rollback(ctx) //nolint:errcheck

		_, err = tx.Exec(ctx, `SET LOCAL ROLE aether_judge_app`)
		require.NoError(t, err, "set role aether_judge_app")

		var deleted bool
		err = tx.QueryRow(ctx,
			`SELECT app.hard_delete('judge.execution_jobs', $1, $2, 'integration test cleanup')`,
			jobID, uuid.New(),
		).Scan(&deleted)
		require.NoError(t, err, "hard_delete must succeed for the app role")
		require.True(t, deleted)

		var count int
		err = tx.QueryRow(ctx, `SELECT count(*) FROM judge.execution_jobs WHERE id = $1`, jobID).Scan(&count)
		require.NoError(t, err, "select count")
		require.Equal(t, 0, count, "the row must be physically gone after hard_delete")
	})
}

// deterministicHex64 returns a deterministic, well-formed 64-character hex string
// satisfying the judge schema's `~ '^[0-9a-f]{64}$'` CHECK constraints. The
// content does not matter for this test — only that the shape is valid.
func deterministicHex64(seed string) string {
	const hexDigits = "0123456789abcdef"
	out := make([]byte, 64)
	for i := range out {
		out[i] = hexDigits[(int(seed[i%len(seed)])+i)%len(hexDigits)]
	}
	return string(out)
}
