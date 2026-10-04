//go:build integration

package repo_test

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/aethercode/aethercode/libs/pkg/database"
	"github.com/aethercode/aethercode/services/judge/internal/adapters/repo"
	"github.com/aethercode/aethercode/services/judge/internal/app"
	"github.com/aethercode/aethercode/services/judge/internal/dispatcher"
)

// TestSubmitDispatchCompleteAndPull walks one job through the whole grading
// path against a real PostgreSQL: submit with both key references, fan-out
// recording per-test weights, decrypt-before-dispatch, completion into the
// outbox, and Pull returning it with the unit weights. Storage and KMS are the
// in-memory fakes from postgres_integration_test.go; the engine is replaced by
// recording verdicts directly, as the worker would.
func TestSubmitDispatchCompleteAndPull(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := bootstrapJudgeSchema(ctx, t)

	_, err := pool.Exec(ctx, `
		INSERT INTO judge.language_mappings (language_key, engine_language_id, engine_version, enabled, max_parallelism)
		VALUES ('python3', 71, '3.11.2', true, 4)
	`)
	require.NoError(t, err, "seed enabled language mapping")

	objectStorage := newFakeStorage()
	keyManager := fakeKMS{}

	bundlePlaintext := []byte(`{"schema_version": 2, "test_cases": [
		{"stdin": "1\n", "expected_output": "1\n", "weight": 2},
		{"stdin": "2\n", "expected_output": "4\n", "weight": 3},
		{"stdin": "3\n", "expected_output": "9\n", "weight": 5}
	]}`)
	bundleCiphertext, bundleKeyRef, err := keyManager.Encrypt(ctx, bundlePlaintext)
	require.NoError(t, err)
	objectStorage.objects["bundles/dispatch-test"] = bundleCiphertext
	bundleSHA256 := sha256.Sum256(bundlePlaintext)

	const sourcePlaintext = "print(int(input()) ** 2)\n"
	sourceCiphertext, sourceKeyRef, err := keyManager.Encrypt(ctx, []byte(sourcePlaintext))
	require.NoError(t, err)
	objectStorage.objects["sources/dispatch-test"] = sourceCiphertext
	sourceSHA256 := sha256.Sum256([]byte(sourcePlaintext))

	correlationID, err := database.NewUUIDv7()
	require.NoError(t, err)
	store := repo.NewPostgres(pool, objectStorage, keyManager)
	execution, err := store.Submit(ctx, app.SubmitExecution{
		IdempotencyKey:          "dispatch-" + correlationID,
		TenantFairnessKey:       "dispatch-tenant:exam",
		SubmissionCorrelationID: correlationID,
		EvaluationBundleRef:     "bundles/dispatch-test",
		EvaluationBundleSHA256:  hex.EncodeToString(bundleSHA256[:]),
		EvaluationBundleKeyRef:  bundleKeyRef,
		SourceKeyRef:            sourceKeyRef,
		SourceCiphertextRef:     "sources/dispatch-test",
		SourceCiphertextSHA256:  hex.EncodeToString(sourceSHA256[:]),
		LanguageKey:             "python3",
		Limits:                  app.Limits{CPUTimeMS: 1000, WallTimeMS: 2000, Memory: 268435456, Processes: 1},
		ExpiresAt:               time.Now().Add(time.Hour),
	})
	require.NoError(t, err, "Submit without request_ciphertext_ref")

	// The admission publisher leases the job's wake-up row; leasing used to
	// fail with "conn busy" and no job ever reached a worker.
	leases, err := store.LeaseAdmissions(ctx, "test-publisher", 10, 30*time.Second)
	require.NoError(t, err, "lease admission rows")
	require.Len(t, leases, 1)
	require.Equal(t, execution.ID, leases[0].JobID)
	require.NotEmpty(t, leases[0].LeaseID)

	var weights []int
	rows, err := pool.Query(ctx, `SELECT weight FROM judge.execution_units WHERE job_id = $1 ORDER BY unit_number`, execution.ID)
	require.NoError(t, err)
	for rows.Next() {
		var weight int
		require.NoError(t, rows.Scan(&weight))
		weights = append(weights, weight)
	}
	rows.Close()
	require.Equal(t, []int{2, 3, 5}, weights, "fan-out must store each test's bundle weight")

	dispatch := repo.NewDispatchStoreAdapter(pool, objectStorage, keyManager)
	job, err := dispatch.FetchQueuedJob(ctx, execution.ID)
	require.NoError(t, err)
	require.NotNil(t, job)
	require.Len(t, job.Units, 3)
	wantStdin := []string{"1\n", "2\n", "3\n"}
	wantExpected := []string{"1\n", "4\n", "9\n"}
	for i, unit := range job.Units {
		require.Equal(t, sourcePlaintext, unit.SourceCode, "engine must receive decrypted source, not a reference")
		require.Equal(t, wantStdin[i], unit.Stdin)
		require.Equal(t, wantExpected[i], unit.ExpectedOutput)
	}

	verdicts := []dispatcher.UnitVerdict{
		{Status: "accepted", TimeMS: 10, MemoryKB: 2048},
		{Status: "wrong_answer", TimeMS: 30, MemoryKB: 1024},
		{Status: "accepted", TimeMS: 20, MemoryKB: 512},
	}
	for i, unit := range job.Units {
		require.NoError(t, dispatch.RecordVerdict(ctx, unit.ID, verdicts[i]))
	}
	require.NoError(t, dispatch.MarkJobComplete(ctx, execution.ID))

	var jobState, eventType string
	require.NoError(t, pool.QueryRow(ctx, `SELECT state FROM judge.execution_jobs WHERE id = $1`, execution.ID).Scan(&jobState))
	require.Equal(t, "failed", jobState)
	require.NoError(t, pool.QueryRow(ctx, `SELECT event_type FROM judge.outbox_events WHERE aggregate_id = $1`, execution.ID).Scan(&eventType))
	require.Equal(t, "judge.completed.v1", eventType)

	finished, err := dispatch.FetchQueuedJob(ctx, execution.ID)
	require.NoError(t, err)
	require.Nil(t, finished, "a completed job must not be dispatched again")

	completions, err := store.Pull(ctx, app.PullCompletedExecutions{ConsumerID: "dispatch-consumer", Limit: 10, LeaseSeconds: 30})
	require.NoError(t, err)
	require.Len(t, completions, 1)
	completion := completions[0]
	require.Equal(t, execution.ID, completion.JobID)
	require.Equal(t, correlationID, completion.SubmissionCorrelationID)
	require.Equal(t, "wrong_answer", completion.Verdict)
	require.Empty(t, completion.ResultRef)
	require.NotNil(t, completion.ExecutionTimeMS)
	require.EqualValues(t, 30, *completion.ExecutionTimeMS, "execution time is the slowest unit")
	require.NotNil(t, completion.MemoryKiB)
	require.EqualValues(t, 2048, *completion.MemoryKiB, "memory is the largest unit")
	require.Len(t, completion.UnitResults, 3)
	for i, wantWeight := range []int{2, 3, 5} {
		require.Equal(t, wantWeight, completion.UnitResults[i].Weight)
	}
}

func TestFetchQueuedJobRejectsJobWithoutSourceKeyReference(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := bootstrapJudgeSchema(ctx, t)
	jobID := insertExecutionJob(ctx, t, pool, "no-source-key-tenant:exam")

	dispatch := repo.NewDispatchStoreAdapter(pool, newFakeStorage(), fakeKMS{})
	_, err := dispatch.FetchQueuedJob(ctx, jobID)
	require.ErrorContains(t, err, "no source key reference")
}
