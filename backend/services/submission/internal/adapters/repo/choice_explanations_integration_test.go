//go:build integration

package repo_test

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"
)

// TestChoiceExplanationsAppearOnlyInReleasedResults proves ADR-0058 in Submission: explanations ride
// the snapshot into the item projection, the exam paper never carries them, and the result shows each
// option with its explanation and whether it was correct only once staff release it.
func TestChoiceExplanationsAppearOnlyInReleasedResults(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := startSubmissionDatabase(ctx, t)

	const why = "Binary search halves the range."
	item := newID(t)
	fixture := itemSubmitFixture{ctx, t, pool, seedAssignedAttempt(ctx, t, pool, "active", fmt.Sprintf(
		`{"exam_item_id":%q,"maximum_score":5,"title":"Pick","prompt_markdown":"Choose.","kind":"mcq",
		  "choices":["O(n)","O(log n)","O(1)"],"correct_choices":[1],"multiple_choice":false,
		  "choice_explanations":[null,%q,null]}`, item, why))}
	staffID := newID(t)
	authorizeActorsInTenant(ctx, t, pool, fixture.CandidateID, staffID)
	var versionID string
	require.NoError(t, pool.QueryRow(ctx, `
		UPDATE submission.attempts AS attempt SET exam_version_id = projection.exam_version_id
		FROM submission.assignment_projections AS projection
		WHERE attempt.id = $1 AND projection.candidate_assignment_id = attempt.candidate_assignment_id
		RETURNING projection.exam_version_id::text`, fixture.AttemptID).Scan(&versionID))
	staff := func(action, resource string, fn func(pgx.Tx) error) error {
		return asActor(ctx, t, pool, staffID, action, resource, fn)
	}
	candidateReads := func(query string) string {
		var raw []byte
		require.NoError(t, asActor(ctx, t, pool, fixture.CandidateID, "submission.read", "submission.attempts", func(transaction pgx.Tx) error {
			return transaction.QueryRow(ctx, query, unitTenantID, fixture.AttemptID).Scan(&raw)
		}))
		return string(raw)
	}

	require.NoError(t, asActor(ctx, t, pool, fixture.CandidateID, "submission.write", "submission.attempts", func(transaction pgx.Tx) error {
		_, err := transaction.Exec(ctx, `SELECT submission.save_choice_answer($1, $2, $3, $4)`, unitTenantID, fixture.AttemptID, item, []int32{1})
		return err
	}))
	require.NotContains(t, candidateReads(`SELECT submission.get_attempt_paper_for_candidate($1, $2)`), why, "the exam paper never carries explanations")

	state, _ := fixture.endTest()
	require.Equal(t, "graded", state)
	require.Equal(t, `{"released": false}`, candidateReads(`SELECT submission.get_attempt_result_for_candidate($1, $2)`), "nothing before release")

	require.NoError(t, staff("submission.write", "submission.score_summaries", func(transaction pgx.Tx) error {
		_, err := transaction.Exec(ctx, `SELECT submission.set_exam_results_release($1, $2, true)`, unitTenantID, versionID)
		return err
	}))
	var released struct {
		Items []struct {
			Options []struct {
				Text        string  `json:"text"`
				Correct     bool    `json:"correct"`
				Explanation *string `json:"explanation"`
			} `json:"options"`
		} `json:"items"`
	}
	require.NoError(t, json.Unmarshal([]byte(candidateReads(`SELECT submission.get_attempt_result_for_candidate($1, $2)`)), &released))
	require.Len(t, released.Items, 1)
	options := released.Items[0].Options
	require.Len(t, options, 3)
	require.Equal(t, "O(log n)", options[1].Text)
	require.True(t, options[1].Correct)
	require.False(t, options[0].Correct)
	require.Nil(t, options[0].Explanation, "an option with none has none")
	require.Equal(t, why, *options[1].Explanation)

	require.NoError(t, staff("submission.write", "submission.score_summaries", func(transaction pgx.Tx) error {
		_, err := transaction.Exec(ctx, `SELECT submission.set_exam_results_release($1, $2, false)`, unitTenantID, versionID)
		return err
	}))
	require.Equal(t, `{"released": false}`, candidateReads(`SELECT submission.get_attempt_result_for_candidate($1, $2)`), "hiding the results hides the explanations")
}
