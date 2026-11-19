//go:build integration

package repo_test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// A published pointer nobody marks consumed is republished forever (every sweep), which floods the broker; a consumed one,
// and one whose job is already finished, must not be.
func TestStaleSweepSkipsConsumedAndFinishedAdmissions(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := bootstrapJudgeSchema(ctx, t)
	store, execution, _ := submitJob(ctx, t, pool, newFakeStorage(), []byte(`{"schema_version": 2, "test_cases": [{"stdin": "1\n", "expected_output": "1\n", "weight": 1}]}`))

	leases, err := store.LeaseAdmissions(ctx, "test-publisher", 10, 30*time.Second)
	require.NoError(t, err)
	require.Len(t, leases, 1)
	require.NoError(t, store.MarkAdmissionPublished(ctx, leases[0].EventID, leases[0].LeaseID))

	future := time.Now().Add(time.Hour)
	requeued, err := store.RequeueStalePublishedAdmissions(ctx, future, 1000)
	require.NoError(t, err)
	require.EqualValues(t, 1, requeued, "an unconsumed pointer of a queued job is republished")

	// The normal case: a published pointer is delivered to a worker and marked consumed.
	_, err = pool.Exec(ctx, `UPDATE judge.admission_outbox SET state = 'published' WHERE event_id = $1`, leases[0].EventID)
	require.NoError(t, err)
	require.NoError(t, store.MarkAdmissionConsumed(ctx, leases[0].EventID))
	var state string
	require.NoError(t, pool.QueryRow(ctx, `SELECT state FROM judge.admission_outbox WHERE event_id = $1`, leases[0].EventID).Scan(&state))
	require.Equal(t, "consumed", state)
	requeued, err = store.RequeueStalePublishedAdmissions(ctx, future, 1000)
	require.NoError(t, err)
	require.EqualValues(t, 0, requeued, "a consumed pointer is not republished")

	// An old pointer that was never marked, but whose job finished, is not republished either.
	_, err = pool.Exec(ctx, `UPDATE judge.admission_outbox SET state = 'published', consumed_at = NULL WHERE event_id = $1`, leases[0].EventID)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `UPDATE judge.execution_jobs SET state = 'completed', terminal_at = clock_timestamp() WHERE id = $1`, execution.ID)
	require.NoError(t, err)
	requeued, err = store.RequeueStalePublishedAdmissions(ctx, future, 1000)
	require.NoError(t, err)
	require.EqualValues(t, 0, requeued, "a finished job's pointer is not republished")
}
