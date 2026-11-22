//go:build integration

package repo_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"
)

// TestFailedGradingQueue covers ADR-0059 §2: staff list/retry/dismiss without leaking source.
func TestFailedGradingQueue(t *testing.T) {
	ctx := context.Background()
	pool := startSubmissionDatabase(ctx, t)

	itemOne, itemTwo := newID(t), newID(t)
	fixture := seedAssignedAttempt(ctx, t, pool, "grading", executableItem(itemOne), executableItem(itemTwo))
	requestOne := seedQueuedRequest(ctx, t, pool, fixture, itemOne)
	requestTwo := seedQueuedRequest(ctx, t, pool, fixture, itemTwo)

	persistFailed := func(requestID, code string) bool {
		var graded bool
		transaction, err := pool.Begin(ctx)
		require.NoError(t, err)
		defer transaction.Rollback(ctx) //nolint:errcheck
		_, err = transaction.Exec(ctx, `SET LOCAL ROLE aether_submission_judge_adapter`)
		require.NoError(t, err)
		require.NoError(t, transaction.QueryRow(ctx, `SELECT submission.mark_evaluation_failed($1, $2, $3, $4, $5, $6)`,
			unitTenantID, requestID, code, newID(t), newID(t), newID(t)).Scan(&graded))
		require.NoError(t, transaction.Commit(ctx))
		return graded
	}
	require.False(t, persistFailed(requestOne, "judge_rejected\nline-two-should-not-leak"))
	require.True(t, persistFailed(requestTwo, "item_not_executable"), "failing the last open request closes grading")

	staffID := newID(t)
	authorizeActorsInTenant(ctx, t, pool, fixture.CandidateID, staffID)
	staff := func(action, resource string, fn func(pgx.Tx) error) error {
		return asActor(ctx, t, pool, staffID, action, resource, fn)
	}

	t.Run("list never exposes source material", func(t *testing.T) {
		var raw []byte
		require.NoError(t, staff("submission.read", "submission.score_summaries", func(transaction pgx.Tx) error {
			return transaction.QueryRow(ctx, `SELECT submission.list_failed_grading_jobs($1, 50, NULL, NULL)`,
				unitTenantID).Scan(&raw)
		}))
		text := string(raw)
		require.NotContains(t, text, "candidate-source")
		require.NotContains(t, text, "source_object_key")
		require.NotContains(t, text, "encryption_key_reference")
		require.Contains(t, text, "judge_rejected")
		require.NotContains(t, text, "line-two-should-not-leak", "only category and first line")

		var parsed struct {
			Items []struct {
				ErrorSummary string `json:"error_summary"`
			} `json:"items"`
		}
		require.NoError(t, json.Unmarshal(raw, &parsed))
		require.Len(t, parsed.Items, 2)
		for _, itemRow := range parsed.Items {
			require.False(t, strings.Contains(itemRow.ErrorSummary, "def "), "summary must not look like source code")
		}
	})

	t.Run("retry is idempotent once the job already left failed", func(t *testing.T) {
		var firstRetry []byte
		require.NoError(t, staff("submission.write", "submission.score_summaries", func(transaction pgx.Tx) error {
			return transaction.QueryRow(ctx, `SELECT submission.retry_failed_grading_job($1, $2)`,
				unitTenantID, requestOne).Scan(&firstRetry)
		}))
		require.Contains(t, string(firstRetry), `"retried": true`)

		var secondRetry []byte
		require.NoError(t, staff("submission.write", "submission.score_summaries", func(transaction pgx.Tx) error {
			return transaction.QueryRow(ctx, `SELECT submission.retry_failed_grading_job($1, $2)`,
				unitTenantID, requestOne).Scan(&secondRetry)
		}))
		require.Contains(t, string(secondRetry), `"retried": false`)

		var state string
		require.NoError(t, pool.QueryRow(ctx, `SELECT lifecycle_state FROM submission.evaluation_requests WHERE id = $1`,
			requestOne).Scan(&state))
		require.Equal(t, "queued", state)
	})
}
