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

// TestRegradeUsesTheCorrectedTests proves ADR-0039: after the item's bundle
// is replaced, a regrade evaluates the student's answer again, the graded
// attempt goes back to grading, and only the evaluation on the new tests
// counts.
func TestRegradeUsesTheCorrectedTests(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := startSubmissionDatabase(ctx, t)
	item := newID(t)
	fixture := itemSubmitFixture{ctx, t, pool, seedAssignedAttempt(ctx, t, pool, "active", executableItem(item))}
	staffID := newID(t)
	authorizeActorsInTenant(ctx, t, pool, fixture.CandidateID, staffID)

	fixture.save(item)
	state, requestIDs := fixture.endTest()
	require.Equal(t, "grading", state)
	fixture.complete(requestIDs[0], "wrong_answer", nonePassed)
	state, score, _ := fixture.score()
	require.Equal(t, "graded", state)
	require.Equal(t, "0.0000", score, "the broken tests failed everyone")

	// Assessment repins the item; the re-sent snapshot carries the new bundle.
	corrected := strings.Repeat("e", 64)
	_, err := pool.Exec(ctx, `UPDATE submission.assignment_item_projections
		SET evaluation_bundle_object_key = 'bundles/eval-fixed.enc', evaluation_bundle_checksum = $2
		WHERE exam_item_id = $1`, item, corrected)
	require.NoError(t, err)
	var versionID string
	require.NoError(t, pool.QueryRow(ctx, `SELECT exam_version_id::text FROM submission.attempts WHERE id = $1`, fixture.AttemptID).Scan(&versionID))

	regrade := func() map[string]float64 {
		var result map[string]float64
		require.NoError(t, asActor(ctx, t, pool, staffID, "submission.write", "submission.score_summaries", func(transaction pgx.Tx) error {
			var raw []byte
			if err := transaction.QueryRow(ctx, `SELECT submission.regrade_exam_item($1, $2, $3)`, unitTenantID, versionID, item).Scan(&raw); err != nil {
				return err
			}
			return json.Unmarshal(raw, &result)
		}))
		return result
	}
	require.Equal(t, map[string]float64{"evaluations": 1, "attempts_regrading": 1}, regrade())
	require.Equal(t, map[string]float64{"evaluations": 0, "attempts_regrading": 0}, regrade(), "a second regrade has nothing new to do")

	var regradeID string
	require.NoError(t, pool.QueryRow(ctx, `SELECT id::text FROM submission.evaluation_requests WHERE attempt_id = $1 AND origin = 'regrade'`,
		fixture.AttemptID).Scan(&regradeID))
	state, _, _ = fixture.score()
	require.Equal(t, "grading", state)
	fixture.complete(regradeID, "accepted", allPassed)
	state, score, maximum := fixture.score()
	require.Equal(t, "graded", state)
	require.Equal(t, "10.0000", score, "the corrected tests decide the score; the old evaluation no longer counts")
	require.Equal(t, "10.0000", maximum)
}
