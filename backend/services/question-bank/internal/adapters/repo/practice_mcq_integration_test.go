//go:build integration

package repo_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"
)

func TestPracticeMcqSubmitShowsExplanations(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := newMigratedPool(ctx, t)
	markAuthorizationProjectionReady(ctx, t, pool)

	staff, student, tenant := uuid.New(), uuid.New(), uuid.New()
	_, err := pool.Exec(ctx, `
		INSERT INTO authz.actor_global_authorizations (actor_id, authz_revision, can_read, can_write, active)
		VALUES ($1, 1, true, true, true)`, staff)
	require.NoError(t, err)

	questionID, versionID := uuid.New(), uuid.New()
	_, err = pool.Exec(ctx, `INSERT INTO qbank.questions (id, slug, created_by, lifecycle_state) VALUES ($1, 'mcq-practice', $2, 'published')`, questionID, staff)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `
		INSERT INTO qbank.question_versions
		    (id, question_id, version_number, title, prompt_markdown, difficulty, kind, choices, correct_choices,
		     multiple_choice, choice_explanations, supported_languages, time_limit_ms, memory_limit_kib,
		     evaluation_bundle_object_key, evaluation_bundle_checksum, encryption_key_reference, created_by)
		VALUES ($1, $2, 1, 'Big-O', 'Pick one.', 'easy', 'mcq', '["O(n)","O(log n)","O(1)"]'::jsonb, '{1}'::int[],
		        false, '["Linear","Logarithmic","Constant"]'::jsonb, '[]'::jsonb, 0, 0,
		        repeat('c', 64), repeat('d', 64), 'local:k', $3)`,
		versionID, questionID, staff)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `UPDATE qbank.question_versions SET status = 'published', published_at = clock_timestamp() WHERE id = $1`, versionID)
	require.NoError(t, err)
	require.NoError(t, asWriter(ctx, pool, staff, "qbank.questions", func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `SELECT qbank.set_question_audience($1, 'practice')`, questionID)
		return err
	}))

	call := func(action, query string, arguments ...any) (json.RawMessage, error) {
		var raw json.RawMessage
		err := asStudent(ctx, pool, student, tenant, action, func(tx pgx.Tx) error {
			return tx.QueryRow(ctx, query, arguments...).Scan(&raw)
		})
		return raw, err
	}

	submissionID := uuid.New()
	_, err = call("qbank.write", `SELECT qbank.start_practice_mcq_submission($1, $2, '{0}'::int[])`, submissionID, questionID)
	require.NoError(t, err)

	raw, err := call("qbank.read", `SELECT qbank.get_practice_submission($1)`, submissionID)
	require.NoError(t, err)
	var body struct {
		Verdict            string   `json:"verdict"`
		ChoiceExplanations []string `json:"choice_explanations"`
		CorrectChoices     []int    `json:"correct_choices"`
	}
	require.NoError(t, json.Unmarshal(raw, &body))
	require.Equal(t, "wrong_answer", body.Verdict)
	require.Equal(t, []int{1}, body.CorrectChoices)
	require.Equal(t, []string{"Linear", "Logarithmic", "Constant"}, body.ChoiceExplanations)
}
