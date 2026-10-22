//go:build integration

package repo_test

import (
	"context"
	"testing"

	"github.com/aethercode/aethercode/services/question-bank/internal/adapters/repo"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"
)

// TestMultipleChoiceQuestions covers ADR-0035 in the question bank: a draft
// becomes multiple-choice with valid options and answer, publishes without
// tests or languages, and resolves with its answer key for Assessment.
func TestMultipleChoiceQuestions(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := newMigratedPool(ctx, t)

	actorID, questionID, versionID := uuid.New(), uuid.New(), uuid.New()
	_, err := pool.Exec(ctx, `INSERT INTO qbank.questions (id, slug, created_by) VALUES ($1, 'mcq', $2)`, questionID, actorID)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `
		INSERT INTO qbank.question_versions
		    (id, question_id, version_number, title, prompt_markdown, difficulty,
		     supported_languages, time_limit_ms, memory_limit_kib, created_by)
		VALUES ($1, $2, 1, 'Big O', 'Binary search runs in?', 'easy', '[]'::jsonb, 1000, 65536, $3)`, versionID, questionID, actorID)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `
		INSERT INTO authz.actor_global_authorizations (actor_id, authz_revision, can_read, can_write, active)
		VALUES ($1, 1, true, true, true)`, actorID)
	require.NoError(t, err)
	markAuthorizationProjectionReady(ctx, t, pool)

	setChoices := func(expected int64, choices string, correct []int32, multiple bool) error {
		return asWriter(ctx, pool, actorID, "qbank.question_versions", func(tx pgx.Tx) error {
			var raw []byte
			return tx.QueryRow(ctx, `SELECT qbank.set_question_version_choices($1, $2, $3::jsonb, $4, $5)`,
				versionID, expected, choices, correct, multiple).Scan(&raw)
		})
	}
	requirePgCode(t, setChoices(1, `["only one"]`, []int32{0}, false), "22023")
	requirePgCode(t, setChoices(1, `["a","b"]`, []int32{0, 1}, false), "22023") // two answers, single choice
	requirePgCode(t, setChoices(1, `["a","b"]`, []int32{2}, false), "22023")    // out of range
	require.NoError(t, setChoices(1, `["O(n)","O(log n)","O(1)"]`, []int32{1}, false))
	requirePgCode(t, setChoices(1, `["a","b"]`, []int32{0}, false), "40001") // stale revision

	require.NoError(t, asWriter(ctx, pool, actorID, "qbank.question_versions", func(tx pgx.Tx) error {
		var raw []byte
		return tx.QueryRow(ctx, `SELECT qbank.publish_question_version($1, $2, $3)`, versionID, uuid.New(), 2).Scan(&raw)
	}), "a multiple-choice question publishes without tests or languages")

	store, err := repo.NewPostgres(pool)
	require.NoError(t, err)
	resolved, err := store.ResolvePublishedQuestionVersion(ctx, versionID.String())
	require.NoError(t, err)
	require.Equal(t, "mcq", resolved.Kind)
	require.Equal(t, []string{"O(n)", "O(log n)", "O(1)"}, resolved.Choices)
	require.Equal(t, []int{1}, resolved.CorrectChoices)
	require.False(t, resolved.MultipleChoice)
	require.Empty(t, resolved.Evaluation.ObjectKey)
}
