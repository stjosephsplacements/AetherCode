//go:build integration

package repo_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

// Migration 000054 ordered its batch by a column the subquery did not select,
// so every call failed with 42703 and Submission would not start with retention
// enabled. Calling the function on a migrated database guards against that.
func TestPurgeExpiredCodeRunsExecutes(t *testing.T) {
	ctx := context.Background()
	pool := startSubmissionDatabase(ctx, t)

	var purgedRuns, purgedUnits int64
	err := pool.QueryRow(ctx, `SELECT purged_runs, purged_units FROM submission.purge_expired_code_runs(10)`).
		Scan(&purgedRuns, &purgedUnits)
	require.NoError(t, err)
	require.Zero(t, purgedRuns)
	require.Zero(t, purgedUnits)
}
