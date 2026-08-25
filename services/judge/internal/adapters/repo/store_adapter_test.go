//go:build integration

package repo_test

import (
	"context"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"github.com/aethercode/aethercode/libs/pkg/database"
	"github.com/aethercode/aethercode/libs/pkg/testutil/integration"
	"github.com/aethercode/aethercode/services/judge/internal/adapters/repo"
	"github.com/aethercode/aethercode/services/judge/internal/app"
	"github.com/aethercode/aethercode/services/judge/internal/dispatcher"
)

// bootstrapJudgeSchema starts a real PostgreSQL container, creates the two
// judge roles, and applies every migration under services/judge/migrations.
// It mirrors the boilerplate already established by TestRLSIsolateTenants and
// TestSubmitFansOutBundleIntoExecutionUnits in postgres_integration_test.go.
func bootstrapJudgeSchema(ctx context.Context, t *testing.T) *pgxpool.Pool {
	t.Helper()
	pool := integration.StartPostgres(ctx, t)

	for _, stmt := range []string{
		`CREATE ROLE aether_judge_migrator NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`CREATE ROLE aether_judge_app      NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`ALTER DATABASE testdb OWNER TO aether_judge_migrator`,
		`ALTER SCHEMA public OWNER TO aether_judge_migrator`,
		`CREATE TABLE public.schema_migrations (version bigint NOT NULL PRIMARY KEY, dirty boolean NOT NULL)`,
		`ALTER TABLE public.schema_migrations OWNER TO aether_judge_migrator`,
	} {
		_, err := pool.Exec(ctx, stmt)
		require.NoError(t, err, "pre-migration setup: %s", stmt[:min(len(stmt), 60)])
	}

	_, file, _, _ := runtime.Caller(0)
	svcRoot := filepath.Join(filepath.Dir(file), "../../..")
	migrationsDir, err := filepath.Abs(filepath.Join(svcRoot, "migrations"))
	require.NoError(t, err)
	integration.ApplyMigrations(ctx, t, pool, migrationsDir)

	return pool
}

// insertExecutionJob inserts one minimal, valid judge.execution_jobs row and
// returns its id. The id is a UUIDv7, matching how Postgres.Submit always
// generates job ids and satisfying the UUIDv7 shape the outbox completion
// trigger requires of aggregate_id when a job is later used there.
func insertExecutionJob(ctx context.Context, t *testing.T, pool *pgxpool.Pool, tenantFairnessKey string) string {
	t.Helper()
	jobID, err := database.NewUUIDv7()
	require.NoError(t, err)
	correlationID, err := database.NewUUIDv7()
	require.NoError(t, err)
	_, err = pool.Exec(ctx,
		`INSERT INTO judge.execution_jobs
		     (id, idempotency_key, request_fingerprint, tenant_fairness_key, submission_correlation_id,
		      evaluation_bundle_ref, evaluation_bundle_sha256, source_ciphertext_ref, source_ciphertext_sha256,
		      request_ciphertext_ref, language_key, cpu_time_limit_ms, wall_time_limit_ms, memory_limit_bytes,
		      process_limit, expires_at)
		 VALUES ($1, $2, $3, $4, $5,
		         'bundles/unit-results-test', $6, 'ciphertext/unit-results-test', $7,
		         'request/unit-results-test', 'python3', 1000, 2000, 268435456,
		         1, $8)`,
		jobID, "unit-results-"+jobID, deterministicHex64("fingerprint"), tenantFairnessKey, correlationID,
		deterministicHex64("bundle"), deterministicHex64("source"), time.Now().Add(time.Hour),
	)
	require.NoError(t, err, "insert execution job")
	return jobID
}

// insertCompletedUnit inserts one terminal judge.execution_units row.
func insertCompletedUnit(
	ctx context.Context, t *testing.T, pool *pgxpool.Pool,
	jobID string, unitNumber int, verdict string, timeMS *int, memoryBytes *int64,
) {
	t.Helper()
	_, err := pool.Exec(ctx,
		`INSERT INTO judge.execution_units
		     (id, job_id, unit_number, test_case_ciphertext_ref, encryption_key_reference,
		      state, normalized_verdict, cpu_time_ms, memory_bytes, terminal_at)
		 VALUES ($1, $2, $3, $4, 'unit-results-test-key', 'completed', $5, $6, $7, clock_timestamp())`,
		uuid.New(), jobID, unitNumber, "test-case/unit-results-test", verdict, timeMS, memoryBytes,
	)
	require.NoError(t, err, "insert execution unit %d", unitNumber)
}

// TestFetchUnitResultsReturnsRowsInUnitNumberOrder proves DispatchStoreAdapter
// reads back every unit's terminal verdict for a job in unit_number order,
// regardless of insertion order, and correctly converts memory_bytes to
// kibibytes. It also guards against a regression of the
// 000008_fix_execution_units_normalized_verdict_check migration: a
// 'compile_error' unit (the vocabulary every other reader/writer in this
// service actually uses) must be insertable and readable at all.
func TestFetchUnitResultsReturnsRowsInUnitNumberOrder(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	pool := bootstrapJudgeSchema(ctx, t)
	jobID := insertExecutionJob(ctx, t, pool, "unit-results-tenant:unit-results-exam")

	timeMS500, timeMS100 := 500, 100
	memoryBytes := int64(2048)

	// Insert out of unit_number order to prove ORDER BY, not insertion order,
	// drives the returned sequence.
	insertCompletedUnit(ctx, t, pool, jobID, 2, "wrong_answer", &timeMS100, nil)
	insertCompletedUnit(ctx, t, pool, jobID, 0, "accepted", &timeMS500, &memoryBytes)
	insertCompletedUnit(ctx, t, pool, jobID, 1, "compile_error", nil, nil)

	store := repo.NewDispatchStoreAdapter(pool)
	results, err := store.FetchUnitResults(ctx, jobID)
	require.NoError(t, err)

	want := []dispatcher.UnitResult{
		{UnitNumber: 0, Verdict: "accepted", TimeMS: &timeMS500, MemoryKB: intPtr(2)},
		{UnitNumber: 1, Verdict: "compile_error"},
		{UnitNumber: 2, Verdict: "wrong_answer", TimeMS: &timeMS100},
	}
	require.Len(t, results, len(want))
	for i, wantRow := range want {
		got := results[i]
		require.Equal(t, wantRow.UnitNumber, got.UnitNumber, "row %d unit_number", i)
		require.Equal(t, wantRow.Verdict, got.Verdict, "row %d verdict", i)
		require.Equal(t, derefOrNil(wantRow.TimeMS), derefOrNil(got.TimeMS), "row %d time_ms", i)
		require.Equal(t, derefOrNil(wantRow.MemoryKB), derefOrNil(got.MemoryKB), "row %d memory_kb", i)
	}
}

// TestFetchUnitResultsReturnsEmptySliceForUnknownJob proves the adapter
// never returns nil for a job with no units, matching the non-nil-slice
// convention used by the rest of this adapter's list-returning methods.
func TestFetchUnitResultsReturnsEmptySliceForUnknownJob(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	pool := bootstrapJudgeSchema(ctx, t)
	store := repo.NewDispatchStoreAdapter(pool)

	unknownJobID, err := database.NewUUIDv7()
	require.NoError(t, err)
	results, err := store.FetchUnitResults(ctx, unknownJobID)
	require.NoError(t, err)
	require.NotNil(t, results)
	require.Empty(t, results)
}

// TestPullPopulatesUnitResultsFromExecutionUnits proves the control-plane
// adapter (Postgres, which is what PullCompletedExecutions actually calls)
// attaches the same per-unit detail to each leased Completion, reading it
// inside the same transaction as the outbox lease itself.
func TestPullPopulatesUnitResultsFromExecutionUnits(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	pool := bootstrapJudgeSchema(ctx, t)
	jobID := insertExecutionJob(ctx, t, pool, "pull-unit-results-tenant:exam")

	timeMS := 250
	memoryBytes := int64(4096)
	insertCompletedUnit(ctx, t, pool, jobID, 0, "accepted", &timeMS, &memoryBytes)
	insertCompletedUnit(ctx, t, pool, jobID, 1, "runtime_error", nil, nil)

	eventID, err := database.NewUUIDv7()
	require.NoError(t, err)
	correlationID, err := database.NewUUIDv7()
	require.NoError(t, err)
	payload := []byte(`{
		"submission_correlation_id": "` + correlationID + `",
		"verdict": "runtime_error",
		"completed_at": "` + time.Now().UTC().Format(time.RFC3339Nano) + `"
	}`)
	_, err = pool.Exec(ctx,
		`INSERT INTO judge.outbox_events (event_id, aggregate_id, event_type, payload, payload_sha256, expires_at)
		 VALUES ($1, $2, 'judge.completed.v1', $3, $4, $5)`,
		eventID, jobID, payload, deterministicHex64("outbox"), time.Now().Add(time.Hour),
	)
	require.NoError(t, err, "insert outbox completion event")

	store := repo.NewPostgres(pool, nil, nil)
	completions, err := store.Pull(ctx, app.PullCompletedExecutions{
		ConsumerID:   "unit-results-consumer",
		Limit:        10,
		LeaseSeconds: 30,
	})
	require.NoError(t, err)
	require.Len(t, completions, 1)

	got := completions[0].UnitResults
	require.Len(t, got, 2)
	require.Equal(t, 0, got[0].UnitNumber)
	require.Equal(t, "accepted", got[0].Verdict)
	require.Equal(t, 250, derefOrNil(got[0].TimeMS))
	require.Equal(t, 4, derefOrNil(got[0].MemoryKB))
	require.Equal(t, 1, got[1].UnitNumber)
	require.Equal(t, "runtime_error", got[1].Verdict)
	require.Nil(t, got[1].TimeMS)
	require.Nil(t, got[1].MemoryKB)
}

func intPtr(v int) *int { return &v }

func derefOrNil(p *int) any {
	if p == nil {
		return nil
	}
	return *p
}
