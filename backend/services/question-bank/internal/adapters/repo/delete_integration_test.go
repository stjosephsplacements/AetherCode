//go:build integration

package repo_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"

	"github.com/aethercode/aethercode/services/question-bank/internal/adapters/repo"
	"github.com/aethercode/aethercode/services/question-bank/internal/app"
)

// TestDeletingQuestions covers ADR-0053: drafts can be deleted through the signed
// write context, a question that was ever published cannot (exams pin it), and a
// draft version can go without touching the published one before it.
func TestDeletingQuestions(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := newMigratedPool(ctx, t)
	actor := uuid.New()
	_, err := pool.Exec(ctx, `INSERT INTO authz.actor_global_authorizations (actor_id, authz_revision, can_read, can_write, active) VALUES ($1, 1, true, true, true)`, actor)
	require.NoError(t, err)
	markAuthorizationProjectionReady(ctx, t, pool)
	store, err := repo.NewPostgres(pool)
	require.NoError(t, err)

	deleted := func(table string, id uuid.UUID) (bool, string, uuid.UUID) {
		var at bool
		var reason *string
		var by *uuid.UUID
		require.NoError(t, pool.QueryRow(ctx, `SELECT deleted_at IS NOT NULL, deletion_reason, deleted_by FROM `+table+` WHERE id = $1`, id).Scan(&at, &reason, &by))
		if reason == nil || by == nil {
			return at, "", uuid.Nil
		}
		return at, *reason, *by
	}
	draftQuestion := func(slug string) (uuid.UUID, uuid.UUID) {
		question, version := uuid.New(), uuid.New()
		require.NoError(t, asWriter(ctx, pool, actor, "qbank.questions", func(tx pgx.Tx) error {
			var raw []byte
			return tx.QueryRow(ctx, `SELECT qbank.create_question($1, $2, $3, $4, 'T', 'P', 'easy', '["python3"]'::jsonb, 1000, 65536, NULL, NULL, NULL, '[]'::jsonb, NULL)`,
				question, version, uuid.New(), slug).Scan(&raw)
		}))
		return question, version
	}
	deleteQuestion := func(id uuid.UUID, reason string, resource string) error {
		return asWriter(ctx, pool, actor, resource, func(tx pgx.Tx) error {
			return store.SoftDeleteQuestion(ctx, tx, app.DeleteQuestion{ID: id.String(), ActorID: uuid.NewString(), Reason: reason})
		})
	}

	// A draft goes, with its versions, recorded against the signed actor and not the one the caller names.
	question, version := draftQuestion("abandoned")
	require.NoError(t, deleteQuestion(question, "  started by mistake  ", "qbank.questions"))
	for table, id := range map[string]uuid.UUID{"qbank.questions": question, "qbank.question_versions": version} {
		gone, reason, by := deleted(table, id)
		require.True(t, gone, table)
		require.Equal(t, "started by mistake", reason)
		require.Equal(t, actor, by, "the actor comes from the signed context")
	}
	require.Error(t, deleteQuestion(question, "again", "qbank.questions"), "already deleted")

	// A reason is required, and a capability for another resource cannot delete.
	other, _ := draftQuestion("other")
	requirePgCode(t, asWriter(ctx, pool, actor, "qbank.questions", func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `SELECT qbank.soft_delete_question($1, '   ')`, other)
		return err
	}), "22023")
	requirePgCode(t, asWriter(ctx, pool, actor, "qbank.categories", func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `SELECT qbank.soft_delete_question($1, 'because')`, other)
		return err
	}), "42501")

	// A question that was published cannot be deleted, and the author is told why.
	published, publishedVersion := uuid.New(), uuid.New()
	_, err = pool.Exec(ctx, `INSERT INTO qbank.questions (id, slug, created_by) VALUES ($1, 'pinned', $2)`, published, actor)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `INSERT INTO qbank.question_versions (id, question_id, version_number, title, prompt_markdown, difficulty, supported_languages, time_limit_ms, memory_limit_kib, created_by)
		VALUES ($1, $2, 1, 'Pinned', 'p', 'easy', '[]'::jsonb, 1000, 65536, $3)`, publishedVersion, published, actor)
	require.NoError(t, err)
	require.NoError(t, asWriter(ctx, pool, actor, "qbank.question_versions", func(tx pgx.Tx) error {
		var raw []byte
		if err := tx.QueryRow(ctx, `SELECT qbank.set_question_version_choices($1, 1, '["a","b"]'::jsonb, '{0}'::int[], false)`, publishedVersion).Scan(&raw); err != nil {
			return err
		}
		return tx.QueryRow(ctx, `SELECT qbank.publish_question_version($1, $2, 2)`, publishedVersion, uuid.New()).Scan(&raw)
	}))
	err = deleteQuestion(published, "tidy up", "qbank.questions")
	require.ErrorContains(t, err, "deleting a published question is not allowed")
	gone, _, _ := deleted("qbank.questions", published)
	require.False(t, gone, "the pinned question is untouched")

	// A draft version of a published question can go; the published version stays resolvable.
	draftVersion := uuid.New()
	var revision int64
	require.NoError(t, pool.QueryRow(ctx, `SELECT version FROM qbank.questions WHERE id = $1`, published).Scan(&revision))
	require.NoError(t, asWriter(ctx, pool, actor, "qbank.question_versions", func(tx pgx.Tx) error {
		var raw []byte
		return tx.QueryRow(ctx, `SELECT qbank.create_draft_question_version($1, $2, $3, $4, 'Pinned 2', 'p', 'easy', '[]'::jsonb, 1000, 65536, NULL, NULL, NULL, '[]'::jsonb)`,
			draftVersion, uuid.New(), published, revision).Scan(&raw)
	}))
	require.NoError(t, asWriter(ctx, pool, actor, "qbank.question_versions", func(tx pgx.Tx) error {
		return store.SoftDeleteQuestionVersion(ctx, tx, app.DeleteQuestionVersion{ID: draftVersion.String(), ActorID: uuid.NewString(), Reason: "wrong draft"})
	}))
	gone, _, _ = deleted("qbank.question_versions", draftVersion)
	require.True(t, gone)
	gone, _, _ = deleted("qbank.questions", published)
	require.False(t, gone, "the question keeps its published version")
	err = asWriter(ctx, pool, actor, "qbank.question_versions", func(tx pgx.Tx) error {
		return store.SoftDeleteQuestionVersion(ctx, tx, app.DeleteQuestionVersion{ID: publishedVersion.String(), ActorID: uuid.NewString(), Reason: "oops"})
	})
	require.ErrorContains(t, err, "deleting a published version is not allowed")
	resolved, err := store.ResolvePublishedQuestionVersion(ctx, publishedVersion.String())
	require.NoError(t, err)
	require.Equal(t, "mcq", resolved.Kind, "an exam can still load the pinned question")

	// Deleting the last version takes the question with it.
	lone, loneVersion := draftQuestion("lone")
	require.NoError(t, asWriter(ctx, pool, actor, "qbank.question_versions", func(tx pgx.Tx) error {
		return store.SoftDeleteQuestionVersion(ctx, tx, app.DeleteQuestionVersion{ID: loneVersion.String(), ActorID: uuid.NewString(), Reason: "not needed"})
	}))
	gone, _, _ = deleted("qbank.questions", lone)
	require.True(t, gone)
}
