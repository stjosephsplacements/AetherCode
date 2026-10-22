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

func choiceItem(itemID string, correct string, multiple bool) string {
	return fmt.Sprintf(`{"exam_item_id":%q,"maximum_score":5,"title":"Pick","prompt_markdown":"Choose.","kind":"mcq",
		"choices":["a","b","c"],"correct_choices":%s,"multiple_choice":%t}`, itemID, correct, multiple)
}

// TestMultipleChoiceAnswers proves ADR-0035 in Submission: selections are
// validated and saved, code cannot be saved to a choice item, the paper never
// carries the key, grading is all-or-nothing, and the maximum counts every
// item the candidate was given, answered or not.
func TestMultipleChoiceAnswers(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := startSubmissionDatabase(ctx, t)
	code, single, multiple := newID(t), newID(t), newID(t)
	fixture := itemSubmitFixture{ctx, t, pool, seedAssignedAttempt(ctx, t, pool, "active",
		executableItem(code), choiceItem(single, "[1]", false), choiceItem(multiple, "[0,2]", true))}
	authorizeActorsInTenant(ctx, t, pool, fixture.CandidateID)

	asCandidate := func(query string, args ...any) error {
		transaction, err := pool.Begin(ctx)
		require.NoError(t, err)
		defer transaction.Rollback(ctx) //nolint:errcheck
		var contextID string
		require.NoError(t, transaction.QueryRow(ctx, `
			INSERT INTO authz.request_contexts
			    (context_id, capability_id, backend_pid, transaction_id, actor_id, tenant_id,
			     authz_revision, action, resource, issued_at, expires_at)
			VALUES (gen_random_uuid(), gen_random_uuid(), pg_backend_pid(), txid_current(),
			        $1, $2, 1, 'submission.write', 'submission.attempts',
			        clock_timestamp(), clock_timestamp() + interval '4 seconds')
			RETURNING context_id::text`, fixture.CandidateID, unitTenantID).Scan(&contextID))
		_, err = transaction.Exec(ctx, `SELECT set_config('app.authz_context_id', $1, true)`, contextID)
		require.NoError(t, err)
		_, err = transaction.Exec(ctx, `SET LOCAL ROLE aether_submission_app`)
		require.NoError(t, err)
		if _, err := transaction.Exec(ctx, query, args...); err != nil {
			return err
		}
		return transaction.Commit(ctx)
	}
	choose := func(itemID string, selected []int32) error {
		transaction, err := pool.Begin(ctx)
		require.NoError(t, err)
		defer transaction.Rollback(ctx) //nolint:errcheck
		var contextID string
		require.NoError(t, transaction.QueryRow(ctx, `
			INSERT INTO authz.request_contexts
			    (context_id, capability_id, backend_pid, transaction_id, actor_id, tenant_id,
			     authz_revision, action, resource, issued_at, expires_at)
			VALUES (gen_random_uuid(), gen_random_uuid(), pg_backend_pid(), txid_current(),
			        $1, $2, 1, 'submission.write', 'submission.attempts',
			        clock_timestamp(), clock_timestamp() + interval '4 seconds')
			RETURNING context_id::text`, fixture.CandidateID, unitTenantID).Scan(&contextID))
		_, err = transaction.Exec(ctx, `SELECT set_config('app.authz_context_id', $1, true)`, contextID)
		require.NoError(t, err)
		_, err = transaction.Exec(ctx, `SET LOCAL ROLE aether_submission_app`)
		require.NoError(t, err)
		if _, err := transaction.Exec(ctx, `SELECT submission.save_choice_answer($1, $2, $3, $4)`, unitTenantID, fixture.AttemptID, itemID, selected); err != nil {
			return err
		}
		return transaction.Commit(ctx)
	}
	require.ErrorContains(t, choose(single, []int32{0, 1}), "selection is invalid", "a single-answer question takes one option")
	require.ErrorContains(t, choose(single, []int32{3}), "selection is invalid")
	require.ErrorContains(t, choose(code, []int32{0}), "not found", "a coding item takes code, not a selection")
	require.NoError(t, choose(single, []int32{0}))
	require.NoError(t, choose(single, []int32{1}), "a later selection replaces the earlier one")
	require.NoError(t, choose(multiple, []int32{0}))

	require.Error(t, asCandidate(`
		SELECT submission.append_answer_revision($1, $2, $3, $4, $5, 'python3', 'candidate-source/t/a/r', repeat('d', 64), 'local/key-2', $6)`,
		newID(t), newID(t), unitTenantID, fixture.AttemptID, single, fixture.attemptVersion()), "code cannot be saved to a choice item")

	var raw []byte
	asCandidateCommitted(ctx, t, pool, fixture.CandidateID, func(transaction pgx.Tx) {
		require.NoError(t, transaction.QueryRow(ctx, `SELECT submission.get_attempt_paper_for_candidate($1, $2)`, unitTenantID, fixture.AttemptID).Scan(&raw))
	})
	require.NotContains(t, string(raw), "correct_choices", "the paper never carries the answer key")
	var paper struct {
		Items []struct {
			ExamItemID   string `json:"exam_item_id"`
			Kind         string `json:"kind"`
			LatestChoice []int  `json:"latest_choice"`
			Choices      []struct {
				Index int    `json:"index"`
				Text  string `json:"text"`
			} `json:"choices"`
		} `json:"items"`
	}
	require.NoError(t, json.Unmarshal(raw, &paper))
	require.Len(t, paper.Items, 3)
	require.Equal(t, "mcq", paper.Items[1].Kind)
	require.Equal(t, []int{1}, paper.Items[1].LatestChoice)
	require.Len(t, paper.Items[1].Choices, 3)

	// Only choices answered: End test grades at once, with no Judge work.
	state, requestIDs := fixture.endTest()
	require.Empty(t, requestIDs)
	require.Equal(t, "graded", state)
	_, score, maximum := fixture.score()
	require.Equal(t, "5.0000", score, "the single answer is right; the multiple one is incomplete, so it scores nothing")
	require.Equal(t, "20.0000", maximum, "the unanswered coding question still counts toward the maximum")
}
