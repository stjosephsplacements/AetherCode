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

// insertCompletedUnit inserts one terminal (state='completed') judge.execution_units row.
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

// insertNonTerminalUnit inserts a judge.execution_units row still in flight
// (state='running'): execution_units_result_check requires normalized_verdict
// be NULL for any unit not in state 'completed', and
// execution_units_terminal_state_check requires terminal_at be NULL for any
// non-terminal state, so neither column is set here.
func insertNonTerminalUnit(ctx context.Context, t *testing.T, pool *pgxpool.Pool, jobID string, unitNumber int) {
	t.Helper()
	_, err := pool.Exec(ctx,
		`INSERT INTO judge.execution_units
		     (id, job_id, unit_number, test_case_ciphertext_ref, encryption_key_reference, state)
		 VALUES ($1, $2, $3, $4, 'unit-results-test-key', 'running')`,
		uuid.New(), jobID, unitNumber, "test-case/unit-results-test",
	)
	require.NoError(t, err, "insert non-terminal execution unit %d", unitNumber)
}

// insertCompletionOutboxEvent inserts one terminal judge.outbox_events row
// referencing jobID, satisfying the completion contract trigger installed by
// 000003_completion_contract_integrity.up.sql.
func insertCompletionOutboxEvent(ctx context.Context, t *testing.T, pool *pgxpool.Pool, jobID, verdict string) {
	t.Helper()
	eventID, err := database.NewUUIDv7()
	require.NoError(t, err)
	correlationID, err := database.NewUUIDv7()
	require.NoError(t, err)
	payload := []byte(`{
		"submission_correlation_id": "` + correlationID + `",
		"verdict": "` + verdict + `",
		"completed_at": "` + time.Now().UTC().Format(time.RFC3339Nano) + `"
	}`)
	_, err = pool.Exec(ctx,
		`INSERT INTO judge.outbox_events (event_id, aggregate_id, event_type, payload, payload_sha256, expires_at)
		 VALUES ($1, $2, 'judge.completed.v1', $3, $4, $5)`,
		eventID, jobID, payload, deterministicHex64("outbox-"+eventID), time.Now().Add(time.Hour),
	)
	require.NoError(t, err, "insert outbox completion event")
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
	insertCompletionOutboxEvent(ctx, t, pool, jobID, "runtime_error")

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

// TestPullReturnsUnitResultsInOrderIncludingCompileError proves the
// unit-results read behind Pull returns rows in unit_number order regardless
// of insertion order, and correctly converts memory_bytes to kibibytes. It
// also guards against a regression of the
// 000008_fix_execution_units_normalized_verdict_check migration: a
// 'compile_error' unit (the vocabulary every other reader/writer in this
// service actually uses) must be insertable and readable at all.
func TestPullReturnsUnitResultsInOrderIncludingCompileError(t *testing.T) {
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
	insertCompletionOutboxEvent(ctx, t, pool, jobID, "compile_error")

	store := repo.NewPostgres(pool, nil, nil)
	completions, err := store.Pull(ctx, app.PullCompletedExecutions{
		ConsumerID:   "unit-results-order-consumer",
		Limit:        10,
		LeaseSeconds: 30,
	})
	require.NoError(t, err)
	require.Len(t, completions, 1)

	got := completions[0].UnitResults
	require.Len(t, got, 3)
	require.Equal(t, 0, got[0].UnitNumber)
	require.Equal(t, "accepted", got[0].Verdict)
	require.Equal(t, 500, derefOrNil(got[0].TimeMS))
	require.Equal(t, 2, derefOrNil(got[0].MemoryKB))
	require.Equal(t, 1, got[1].UnitNumber)
	require.Equal(t, "compile_error", got[1].Verdict)
	require.Equal(t, 2, got[2].UnitNumber)
	require.Equal(t, "wrong_answer", got[2].Verdict)
	require.Equal(t, 100, derefOrNil(got[2].TimeMS))
}

// TestPullExcludesNonTerminalUnitsFromUnitResults proves that a job with a
// mix of completed and still-in-flight units only surfaces the completed
// ones' results: including a non-terminal unit (normalized_verdict NULL)
// would otherwise scan as an empty, unrecognized verdict string, which
// completionVerdictCode rejects with codes.Internal -- poisoning the entire
// PullCompletedExecutions batch, not just this one job.
func TestPullExcludesNonTerminalUnitsFromUnitResults(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	pool := bootstrapJudgeSchema(ctx, t)
	jobID := insertExecutionJob(ctx, t, pool, "unit-results-mixed-tenant:exam")

	insertCompletedUnit(ctx, t, pool, jobID, 0, "accepted", nil, nil)
	insertNonTerminalUnit(ctx, t, pool, jobID, 1)
	insertCompletionOutboxEvent(ctx, t, pool, jobID, "accepted")

	store := repo.NewPostgres(pool, nil, nil)
	completions, err := store.Pull(ctx, app.PullCompletedExecutions{
		ConsumerID:   "unit-results-mixed-consumer",
		Limit:        10,
		LeaseSeconds: 30,
	})
	require.NoError(t, err)
	require.Len(t, completions, 1)

	got := completions[0].UnitResults
	require.Len(t, got, 1, "the non-terminal unit must be excluded, not surfaced as an empty verdict")
	require.Equal(t, 0, got[0].UnitNumber)
	require.Equal(t, "accepted", got[0].Verdict)
}

func derefOrNil(p *int) any {
	if p == nil {
		return nil
	}
	return *p
}
