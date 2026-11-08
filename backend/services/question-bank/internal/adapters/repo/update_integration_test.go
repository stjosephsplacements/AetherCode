//go:build integration

package repo_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"

	"github.com/stjosephsplacements/AetherCode/services/question-bank/internal/adapters/repo"
	"github.com/stjosephsplacements/AetherCode/services/question-bank/internal/app"
)

func ptr[T any](value T) *T { return &value }

// TestEditingADraftQuestion covers ADR-0054: a draft's fields change one at a time,
// a stale revision and a published version are refused, and changing a limit
// makes an earlier passing model check stale.
func TestEditingADraftQuestion(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := newMigratedPool(ctx, t)
	actor := uuid.New()
	_, err := pool.Exec(ctx, `INSERT INTO authz.actor_global_authorizations (actor_id, authz_revision, can_read, can_write, active) VALUES ($1, 1, true, true, true)`, actor)
	require.NoError(t, err)
	markAuthorizationProjectionReady(ctx, t, pool)
	store, err := repo.NewPostgres(pool)
	require.NoError(t, err)

	question, version := uuid.New(), uuid.New()
	require.NoError(t, asWriter(ctx, pool, actor, "qbank.questions", func(tx pgx.Tx) error {
		var raw []byte
		return tx.QueryRow(ctx, `SELECT qbank.create_question($1, $2, $3, 'editable', 'Old title', 'Old statement', 'easy', '["python3"]'::jsonb, 1000, 65536, NULL, NULL, NULL, '[]'::jsonb, NULL)`,
			question, version, uuid.New()).Scan(&raw)
	}))
	update := func(command app.UpdateQuestionVersion) (app.QuestionVersion, error) {
		var result app.QuestionVersion
		err := asWriter(ctx, pool, actor, "qbank.question_versions", func(tx pgx.Tx) (err error) {
			command.QuestionVersionID = version.String()
			result, err = store.UpdateQuestionVersion(ctx, tx, command)
			return err
		})
		return result, err
	}

	var revision int64
	require.NoError(t, pool.QueryRow(ctx, `SELECT version FROM qbank.question_versions WHERE id = $1`, version).Scan(&revision))
	edited, err := update(app.UpdateQuestionVersion{ExpectedQuestionVersion: revision, Title: ptr("  New title "), Difficulty: ptr("hard")})
	require.NoError(t, err)
	require.Equal(t, "New title", edited.Title)
	require.Equal(t, "hard", edited.Difficulty)
	require.Equal(t, "Old statement", edited.PromptMarkdown, "a field left out stays as it was")

	_, err = update(app.UpdateQuestionVersion{ExpectedQuestionVersion: revision, Title: ptr("Stale")})
	require.Error(t, err, "the revision moved on")

	var bundle string
	_, err = pool.Exec(ctx, `INSERT INTO qbank.model_checks (id, question_version_id, language_key, source_object_key, source_checksum, source_key_reference, requested_by, bundle_checksum, lifecycle_state, verdict, completed_at)
		VALUES ($1, $2, 'python3', 'k', repeat('a', 64), 'ref', $3, repeat('b', 64), 'completed', 'accepted', now())`, uuid.New(), version, actor)
	require.NoError(t, err)
	_, err = update(app.UpdateQuestionVersion{ExpectedQuestionVersion: revision + 1, TimeLimitMS: ptr(3000)})
	require.NoError(t, err)
	require.NoError(t, pool.QueryRow(ctx, `SELECT COALESCE(bundle_checksum, 'cleared') FROM qbank.model_checks WHERE question_version_id = $1`, version).Scan(&bundle))
	require.Equal(t, "cleared", bundle, "a passing check from before the limit changed no longer counts")

	// A published version never changes. A multiple-choice one publishes without a model check.
	published, publishedVersion := uuid.New(), uuid.New()
	_, err = pool.Exec(ctx, `INSERT INTO qbank.questions (id, slug, created_by) VALUES ($1, 'frozen', $2)`, published, actor)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `INSERT INTO qbank.question_versions (id, question_id, version_number, title, prompt_markdown, difficulty, supported_languages, time_limit_ms, memory_limit_kib, created_by)
		VALUES ($1, $2, 1, 'Frozen', 'p', 'easy', '[]'::jsonb, 1000, 65536, $3)`, publishedVersion, published, actor)
	require.NoError(t, err)
	require.NoError(t, asWriter(ctx, pool, actor, "qbank.question_versions", func(tx pgx.Tx) error {
		var raw []byte
		if err := tx.QueryRow(ctx, `SELECT qbank.set_question_version_choices($1, 1, '["a","b"]'::jsonb, '{0}'::int[], false)`, publishedVersion).Scan(&raw); err != nil {
			return err
		}
		return tx.QueryRow(ctx, `SELECT qbank.publish_question_version($1, $2, 2)`, publishedVersion, uuid.New()).Scan(&raw)
	}))
	err = asWriter(ctx, pool, actor, "qbank.question_versions", func(tx pgx.Tx) error {
		_, err := store.UpdateQuestionVersion(ctx, tx, app.UpdateQuestionVersion{QuestionVersionID: publishedVersion.String(), ExpectedQuestionVersion: 3, Title: ptr("Too late")})
		return err
	})
	require.Error(t, err)
}
