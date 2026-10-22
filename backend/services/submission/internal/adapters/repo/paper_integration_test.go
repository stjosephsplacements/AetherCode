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

// TestCandidatePaper proves the snapshot's statements reach the candidate in
// order, with the latest saved answer's storage reference, and that nobody
// else can read the paper (ADR-0023).
func TestCandidatePaper(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := startSubmissionDatabase(ctx, t)
	first, second := newID(t), newID(t)
	fixture := seedAssignedAttempt(ctx, t, pool, "active", executableItem(first), executableItem(second))

	// A later snapshot of the same assignment carries the paper.
	withStatement := func(itemID, title string) string {
		return strings.TrimSuffix(executableItem(itemID), "}") + `,"title":"` + title + `","prompt_markdown":"Solve ` + title + `."}`
	}
	_, err := pool.Exec(ctx, `
		SELECT submission.apply_assignment_snapshot(
			$1, $2, $3, $4, gen_random_uuid(), gen_random_uuid(),
			clock_timestamp() - interval '1 hour', clock_timestamp() + interval '2 hours',
			1::smallint, 'active', 2, $5::jsonb, 3600, 'Lab test 2', 'Answer both questions.'
		)`, newID(t), unitTenantID, fixture.AssignmentID, fixture.CandidateID,
		"["+withStatement(first, "Sum")+","+withStatement(second, "Reverse")+"]")
	require.NoError(t, err)
	authorizeActorsInTenant(ctx, t, pool, fixture.CandidateID)

	asCandidate(ctx, t, pool, fixture.CandidateID, func(transaction pgx.Tx) {
		for revision, key := range []string{"candidate-source/1", "candidate-source/2"} {
			_, err := transaction.Exec(ctx, `
				SELECT submission.append_answer_revision($1, $2, $3, $4, $5, 'python3', $6, repeat('d', 64), 'local/key-2', $7)`,
				newID(t), newID(t), unitTenantID, fixture.AttemptID, first, key, revision+1)
			require.NoError(t, err)
		}
		var raw []byte
		require.NoError(t, transaction.QueryRow(ctx, `SELECT submission.get_attempt_paper_for_candidate($1, $2)`,
			unitTenantID, fixture.AttemptID).Scan(&raw))
		var paper struct {
			Title                string `json:"title"`
			InstructionsMarkdown string `json:"instructions_markdown"`
			Items                []struct {
				ExamItemID     string `json:"exam_item_id"`
				Position       int    `json:"position"`
				Title          string `json:"title"`
				PromptMarkdown string `json:"prompt_markdown"`
				LatestAnswer   *struct {
					RevisionNumber  int    `json:"revision_number"`
					SourceObjectKey string `json:"source_object_key"`
				} `json:"latest_answer"`
			} `json:"items"`
		}
		require.NoError(t, json.Unmarshal(raw, &paper))
		require.Equal(t, "Lab test 2", paper.Title)
		require.Equal(t, "Answer both questions.", paper.InstructionsMarkdown)
		require.Len(t, paper.Items, 2)
		require.Equal(t, first, paper.Items[0].ExamItemID)
		require.Equal(t, 1, paper.Items[0].Position)
		require.Equal(t, "Sum", paper.Items[0].Title)
		require.Equal(t, "Solve Sum.", paper.Items[0].PromptMarkdown)
		require.NotNil(t, paper.Items[0].LatestAnswer)
		require.Equal(t, 2, paper.Items[0].LatestAnswer.RevisionNumber)
		require.Equal(t, "candidate-source/2", paper.Items[0].LatestAnswer.SourceObjectKey)
		require.Equal(t, 2, paper.Items[1].Position)
		require.Nil(t, paper.Items[1].LatestAnswer)
	})

	stranger := newID(t)
	authorizeActorsInTenant(ctx, t, pool, stranger)
	asCandidate(ctx, t, pool, stranger, func(transaction pgx.Tx) {
		var raw []byte
		err := transaction.QueryRow(ctx, `SELECT submission.get_attempt_paper_for_candidate($1, $2)`,
			unitTenantID, fixture.AttemptID).Scan(&raw)
		require.ErrorContains(t, err, "candidate attempt was not found")
	})
}
