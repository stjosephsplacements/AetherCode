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

// TestModelChecks covers ADR-0033's database side: an author starts a check
// for an allowed language on a version with tests, at most three run at once,
// only the Judge completion worker records outcomes, and authors read them.
func TestModelChecks(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := newMigratedPool(ctx, t)

	actorID, questionID, versionID := uuid.New(), uuid.New(), uuid.New()
	_, err := pool.Exec(ctx, `INSERT INTO qbank.questions (id, slug, created_by) VALUES ($1, 'model-check', $2)`, questionID, actorID)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `
		INSERT INTO qbank.question_versions
		    (id, question_id, version_number, title, prompt_markdown, difficulty,
		     supported_languages, time_limit_ms, memory_limit_kib, created_by)
		VALUES ($1, $2, 1, 'Sum', 'Print a + b.', 'easy', '["python3","c"]'::jsonb, 1500, 65536, $3)`, versionID, questionID, actorID)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `
		INSERT INTO authz.actor_global_authorizations (actor_id, authz_revision, can_read, can_write, active)
		VALUES ($1, 1, true, true, true)`, actorID)
	require.NoError(t, err)
	markAuthorizationProjectionReady(ctx, t, pool)

	start := func(language string) (map[string]any, error) {
		var target map[string]any
		err := asWriter(ctx, pool, actorID, "qbank.question_versions", func(tx pgx.Tx) error {
			var raw []byte
			if err := tx.QueryRow(ctx, `SELECT qbank.start_model_check($1, $2, $3, 'qbank/x/source', repeat('d', 64), 'local:k')`,
				uuid.New(), versionID, language).Scan(&raw); err != nil {
				return err
			}
			return json.Unmarshal(raw, &target)
		})
		return target, err
	}

	_, err = start("python3")
	requirePgCode(t, err, "55000") // no tests saved yet
	require.NoError(t, asWriter(ctx, pool, actorID, "qbank.test_case_manifests", func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `SELECT * FROM qbank.set_question_version_tests($1, 1, 'eval', repeat('a', 64), 'local:k',
			'sample', repeat('b', 64), 'local:k', 1, 'hidden', repeat('c', 64), 'local:k', 1)`, versionID)
		return err
	}))
	_, err = start("java")
	requirePgCode(t, err, "22023")

	target, err := start("python3")
	require.NoError(t, err)
	require.Equal(t, "eval", target["evaluation_bundle_object_key"])
	require.EqualValues(t, 1500, target["time_limit_ms"])
	_, err = start("c")
	require.NoError(t, err)
	_, err = start("c")
	require.NoError(t, err)
	_, err = start("c")
	requirePgCode(t, err, "55000") // three already running

	var checkID string
	require.NoError(t, pool.QueryRow(ctx, `SELECT id::text FROM qbank.model_checks WHERE language_key = 'python3'`).Scan(&checkID))

	// The app role cannot record an outcome; the completion worker can.
	err = asWriter(ctx, pool, actorID, "qbank.question_versions", func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `SELECT qbank.finish_model_check($1, 'completed', 'accepted', '[]'::jsonb)`, checkID)
		return err
	})
	requirePgCode(t, err, "42501")
	worker, err := pool.Begin(ctx)
	require.NoError(t, err)
	_, err = worker.Exec(ctx, `SET LOCAL ROLE aether_question_bank_projection_worker`)
	require.NoError(t, err)
	var found bool
	require.NoError(t, worker.QueryRow(ctx, `SELECT qbank.finish_model_check($1, 'completed', 'wrong_answer',
		'[{"unit_number":0,"verdict":"accepted","weight":1},{"unit_number":1,"verdict":"wrong_answer","weight":3}]'::jsonb)`, checkID).Scan(&found))
	require.True(t, found)
	require.NoError(t, worker.QueryRow(ctx, `SELECT qbank.finish_model_check($1, 'completed', 'accepted', '[]'::jsonb)`, uuid.New()).Scan(&found))
	require.False(t, found, "an unknown check is reported, so the worker still acknowledges it")
	require.NoError(t, worker.Commit(ctx))

	var checks []struct {
		Language string `json:"language"`
		State    string `json:"lifecycle_state"`
		Verdict  string `json:"verdict"`
		Units    []any  `json:"units"`
	}
	require.NoError(t, asWriter(ctx, pool, actorID, "qbank.question_versions", func(tx pgx.Tx) error {
		var raw []byte
		if err := tx.QueryRow(ctx, `SELECT qbank.list_model_checks($1)`, versionID).Scan(&raw); err != nil {
			return err
		}
		return json.Unmarshal(raw, &checks)
	}))
	require.Len(t, checks, 3)
	var python = checks[len(checks)-1]
	require.Equal(t, "python3", python.Language)
	require.Equal(t, "completed", python.State)
	require.Equal(t, "wrong_answer", python.Verdict)
	require.Len(t, python.Units, 2)
}
