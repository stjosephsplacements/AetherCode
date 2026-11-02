//go:build integration

package repo_test

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/aethercode/aethercode/services/question-bank/internal/adapters/repo"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"
)

// Explanations are stored beside the options, checked against them, frozen on publish,
// and absent from what the exam runner resolves (ADR-0058).
func TestChoiceExplanations(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := newMigratedPool(ctx, t)

	actorID, questionID, versionID := uuid.New(), uuid.New(), uuid.New()
	_, err := pool.Exec(ctx, `INSERT INTO qbank.questions (id, slug, created_by) VALUES ($1, 'mcq-why', $2)`, questionID, actorID)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `
		INSERT INTO qbank.question_versions
		    (id, question_id, version_number, title, prompt_markdown, difficulty,
		     supported_languages, time_limit_ms, memory_limit_kib, created_by)
		VALUES ($1, $2, 1, 'Big O', 'Binary search runs in?', 'easy', '[]'::jsonb, 1000, 65536, $3)`, versionID, questionID, actorID)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `INSERT INTO authz.actor_global_authorizations (actor_id, authz_revision, can_read, can_write, active) VALUES ($1, 1, true, true, true)`, actorID)
	require.NoError(t, err)
	markAuthorizationProjectionReady(ctx, t, pool)

	const secret = "It halves the range every step."
	set := func(expected int64, explanations any) (map[string]any, error) {
		var summary map[string]any
		err := asWriter(ctx, pool, actorID, "qbank.question_versions", func(tx pgx.Tx) error {
			var raw []byte
			if err := tx.QueryRow(ctx, `SELECT qbank.set_question_version_choices($1, $2, '["O(n)","O(log n)","O(1)"]'::jsonb, $3, false, $4::jsonb)`,
				versionID, expected, []int32{1}, explanations).Scan(&raw); err != nil {
				return err
			}
			return json.Unmarshal(raw, &summary)
		})
		return summary, err
	}
	stored := func() any {
		var raw []byte
		require.NoError(t, pool.QueryRow(ctx, `SELECT choice_explanations FROM qbank.question_versions WHERE id = $1`, versionID).Scan(&raw))
		if raw == nil {
			return nil
		}
		var decoded any
		require.NoError(t, json.Unmarshal(raw, &decoded))
		return decoded
	}

	// One entry per option, text or null, up to 1,000 characters.
	_, err = set(1, `["too","few"]`)
	requirePgCode(t, err, "22023")
	_, err = set(1, `["a","b","c","d"]`)
	requirePgCode(t, err, "22023")
	_, err = set(1, `[1, null, null]`)
	requirePgCode(t, err, "22023")
	_, err = set(1, `{"0":"object"}`)
	requirePgCode(t, err, "22023")
	_, err = set(1, `["`+strings.Repeat("x", 1001)+`", null, null]`)
	requirePgCode(t, err, "22023")

	summary, err := set(1, `[null, "`+secret+`", null]`)
	require.NoError(t, err)
	require.Equal(t, []any{nil, secret, nil}, summary["choice_explanations"], "staff see the explanations with the choices")
	require.Equal(t, []any{nil, secret, nil}, stored())

	// The table refuses a mismatch from any path, not only through the function.
	_, err = pool.Exec(ctx, `UPDATE qbank.question_versions SET choice_explanations = '["only one"]'::jsonb WHERE id = $1`, versionID)
	requirePgCode(t, err, "23514")

	// Replacing the options without explanations (a pod on the previous release) clears them rather than leave them by index.
	_, err = set(2, nil)
	require.NoError(t, err)
	require.Nil(t, stored())
	_, err = set(3, `["a","b","c"]`)
	require.NoError(t, err)

	require.NoError(t, asWriter(ctx, pool, actorID, "qbank.question_versions", func(tx pgx.Tx) error {
		var raw []byte
		return tx.QueryRow(ctx, `SELECT qbank.publish_question_version($1, $2, $3)`, versionID, uuid.New(), 4).Scan(&raw)
	}))
	_, err = set(5, `["x","y","z"]`)
	requirePgCode(t, err, "55000") // a published version is immutable

	// What the exam runner resolves carries no explanation text.
	store, err := repo.NewPostgres(pool)
	require.NoError(t, err)
	resolved, err := store.ResolvePublishedQuestionVersion(ctx, versionID.String())
	require.NoError(t, err)
	encoded, err := json.Marshal(resolved)
	require.NoError(t, err)
	require.NotContains(t, strings.ToLower(string(encoded)), "explanation")
	var resolveColumns int
	require.NoError(t, pool.QueryRow(ctx, `
		SELECT count(*) FROM pg_proc WHERE proname = 'resolve_published_version' AND pg_get_functiondef(oid) ILIKE '%explanation%'`).Scan(&resolveColumns))
	require.Zero(t, resolveColumns)
}

func TestChoiceExplanationsDownMigration(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := newMigratedPool(ctx, t)
	down, err := os.ReadFile(filepath.Join(migrationsDirectory(t), "000026_choice_explanations.down.sql"))
	require.NoError(t, err)
	_, err = pool.Exec(ctx, string(down))
	require.NoError(t, err)
	var columns int
	require.NoError(t, pool.QueryRow(ctx, `SELECT count(*) FROM information_schema.columns WHERE table_schema = 'qbank' AND column_name = 'choice_explanations'`).Scan(&columns))
	require.Zero(t, columns)
	// The five-argument function is back.
	var arguments int
	require.NoError(t, pool.QueryRow(ctx, `SELECT pronargs FROM pg_proc WHERE proname = 'set_question_version_choices'`).Scan(&arguments))
	require.Equal(t, 5, arguments)
}
